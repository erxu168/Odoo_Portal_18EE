/**
 * Issues & Requests Module — SQLite Schema & CRUD
 *
 * 7 tables: issues, issue_type_data, issue_media, issue_comments,
 *           equipment, equipment_docs, equipment_photos
 *
 * Equipment syncs to Odoo 18 EE maintenance.equipment via the
 * krawings_issues custom module. Issues stay in SQLite only.
 */
import { getDb } from './db';
import { randomUUID } from 'crypto';
import type {
  Issue, IssueType, IssueStatus, Urgency, Priority,
  IssueTypeData, IssueMedia, IssueComment,
  Equipment, EquipmentDoc, EquipmentPhoto,
  CreateIssueInput, UpdateIssueInput,
  IssuesDashboardData,
} from '@/types/issues';

// Berlin time helper — matches kds-db.ts pattern. Never use toISOString() (that's UTC).
function nowISO(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T');
}

const RESTRICTED_TYPES_SET = new Set(['injury', 'security', 'food_safety']);
const AUTO_URGENT_SET = new Set(['injury', 'security']);

// ===
// SCHEMA INIT (lazy, matches kds-db.ts pattern)
// ===

let _initialized = false;

function ensureTables() {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      urgency TEXT NOT NULL DEFAULT 'normal',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      location_custom TEXT,
      department TEXT NOT NULL,
      reporter_id INTEGER NOT NULL,
      assigned_to TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      deadline TEXT,
      equipment_text TEXT,
      equipment_id TEXT,
      restricted INTEGER NOT NULL DEFAULT 0,
      manager_notes TEXT,
      resolution TEXT,
      repair_cost REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issue_type_data (
      issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
      data TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS issue_media (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'photo',
      phase TEXT NOT NULL DEFAULT 'before',
      file_path TEXT NOT NULL,
      thumbnail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issue_comments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issues_equipment (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      serial_number TEXT,
      location TEXT NOT NULL,
      location_detail TEXT,
      purchase_date TEXT,
      purchase_cost REAL,
      warranty_expires TEXT,
      vendor_name TEXT,
      vendor_contact TEXT,
      qr_code TEXT NOT NULL UNIQUE,
      odoo_equipment_id INTEGER,
      total_repair_cost REAL NOT NULL DEFAULT 0,
      repair_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issues_equipment_docs (
      id TEXT PRIMARY KEY,
      equipment_id TEXT NOT NULL REFERENCES issues_equipment(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'other'
    );

    CREATE TABLE IF NOT EXISTS issues_equipment_photos (
      id TEXT PRIMARY KEY,
      equipment_id TEXT NOT NULL REFERENCES issues_equipment(id) ON DELETE CASCADE,
      photo_type TEXT NOT NULL DEFAULT 'equipment',
      file_path TEXT NOT NULL,
      thumbnail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(type);
    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_issues_location ON issues(location);
    CREATE INDEX IF NOT EXISTS idx_issues_reporter ON issues(reporter_id);
    CREATE INDEX IF NOT EXISTS idx_issues_restricted ON issues(restricted);
    CREATE INDEX IF NOT EXISTS idx_issues_created ON issues(created_at);
    CREATE INDEX IF NOT EXISTS idx_issue_media_issue ON issue_media(issue_id);
    CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id);
    CREATE INDEX IF NOT EXISTS idx_issues_equipment_location ON issues_equipment(location);
    CREATE INDEX IF NOT EXISTS idx_issues_equipment_qr ON issues_equipment(qr_code);
  `);
  _initialized = true;
}

// Exported for API routes that want to force init on module load
export function initIssuesTables() {
  ensureTables();
}

// ===
// ISSUES CRUD
// ===

export function createIssue(data: CreateIssueInput, reporterId: number, _reporterName: string): string {
  ensureTables();
  const db = getDb();
  const id = randomUUID();
  const ts = nowISO();
  const restricted = RESTRICTED_TYPES_SET.has(data.type) ? 1 : 0;
  const urgency = AUTO_URGENT_SET.has(data.type) ? 'urgent' : (data.urgency || 'normal');

  const title = data.description.length > 60
    ? data.description.substring(0, 57) + '...'
    : data.description;

  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO issues (id, type, status, urgency, title, description, location, location_custom,
        department, reporter_id, priority, equipment_text, restricted, created_at, updated_at)
      VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?)
    `).run(
      id, data.type, urgency, title, data.description,
      data.location, data.location_custom || null,
      data.department, reporterId, data.equipment_text || null,
      restricted, ts, ts
    );

    db.prepare('INSERT INTO issue_type_data (issue_id, data) VALUES (?, ?)')
      .run(id, JSON.stringify(data.type_data || {}));
  });

  insert();
  return id;
}

export function getIssue(id: string): (Issue & { type_data: IssueTypeData }) | null {
  ensureTables();
  const db = getDb();
  const row = db.prepare(`
    SELECT i.*, td.data as type_data_json,
      (SELECT name FROM portal_users WHERE id = i.reporter_id) as reporter_name,
      (SELECT name FROM issues_equipment WHERE id = i.equipment_id) as equipment_name
    FROM issues i
    LEFT JOIN issue_type_data td ON td.issue_id = i.id
    WHERE i.id = ?
  `).get(id) as Record<string, unknown> | undefined;

  if (!row) return null;
  return parseIssueWithTypeData(row);
}

export function listIssues(filters: {
  type?: IssueType;
  status?: IssueStatus;
  location?: string;
  reporter_id?: number;
  restricted_only?: boolean;
  exclude_restricted?: boolean;
  limit?: number;
  offset?: number;
}): Issue[] {
  ensureTables();
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.type) { where.push('i.type = ?'); params.push(filters.type); }
  if (filters.status) { where.push('i.status = ?'); params.push(filters.status); }
  if (filters.location) { where.push('i.location LIKE ?'); params.push(filters.location + '%'); }
  if (filters.reporter_id) { where.push('i.reporter_id = ?'); params.push(filters.reporter_id); }
  if (filters.restricted_only) { where.push('i.restricted = 1'); }
  if (filters.exclude_restricted) { where.push('i.restricted = 0'); }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const rows = db.prepare(`
    SELECT i.*,
      (SELECT name FROM portal_users WHERE id = i.reporter_id) as reporter_name
    FROM issues i
    ${whereClause}
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(parseIssueBasic);
}

export function getLocationFeed(location: string, userId: number, userRole: string): Issue[] {
  ensureTables();
  const db = getDb();
  const isManager = userRole === 'manager' || userRole === 'admin';

  const rows = isManager
    ? db.prepare(`
        SELECT i.*,
          (SELECT name FROM portal_users WHERE id = i.reporter_id) as reporter_name
        FROM issues i
        WHERE i.location LIKE ?
        ORDER BY i.created_at DESC
        LIMIT 50
      `).all(location + '%') as Record<string, unknown>[]
    : db.prepare(`
        SELECT i.*,
          (SELECT name FROM portal_users WHERE id = i.reporter_id) as reporter_name
        FROM issues i
        WHERE i.location LIKE ?
          AND (i.restricted = 0 OR i.reporter_id = ?)
        ORDER BY i.created_at DESC
        LIMIT 50
      `).all(location + '%', userId) as Record<string, unknown>[];

  return rows.map(parseIssueBasic);
}

export function updateIssue(id: string, data: UpdateIssueInput): void {
  ensureTables();
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
  if (data.assigned_to !== undefined) { sets.push('assigned_to = ?'); vals.push(data.assigned_to); }
  if (data.priority !== undefined) { sets.push('priority = ?'); vals.push(data.priority); }
  if (data.deadline !== undefined) { sets.push('deadline = ?'); vals.push(data.deadline); }
  if (data.equipment_id !== undefined) { sets.push('equipment_id = ?'); vals.push(data.equipment_id); }
  if (data.manager_notes !== undefined) { sets.push('manager_notes = ?'); vals.push(data.manager_notes); }
  if (data.resolution !== undefined) { sets.push('resolution = ?'); vals.push(data.resolution); }
  if (data.repair_cost !== undefined) { sets.push('repair_cost = ?'); vals.push(data.repair_cost); }

  if (sets.length > 0) {
    sets.push('updated_at = ?'); vals.push(nowISO());
    vals.push(id);
    db.prepare(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  if (data.type_data) {
    const existing = db.prepare('SELECT data FROM issue_type_data WHERE issue_id = ?').get(id) as { data: string } | undefined;
    const merged = { ...(existing ? JSON.parse(existing.data) : {}), ...data.type_data };
    db.prepare('UPDATE issue_type_data SET data = ? WHERE issue_id = ?').run(JSON.stringify(merged), id);
  }
}

/**
 * When a repair is resolved with a cost, update the linked equipment's running totals.
 */
export function recordRepairCost(issueId: string, cost: number): void {
  ensureTables();
  const db = getDb();
  const issue = db.prepare('SELECT equipment_id FROM issues WHERE id = ?').get(issueId) as { equipment_id: string | null } | undefined;
  if (issue?.equipment_id) {
    db.prepare(`
      UPDATE issues_equipment
      SET total_repair_cost = total_repair_cost + ?,
          repair_count = repair_count + 1,
          updated_at = ?
      WHERE id = ?
    `).run(cost, nowISO(), issue.equipment_id);
  }
}

// ===
// MEDIA CRUD
// ===

export function addMedia(issueId: string, filePath: string, type: 'photo' | 'video' = 'photo', phase: 'before' | 'after' = 'before', thumbnail?: string): string {
  ensureTables();
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO issue_media (id, issue_id, type, phase, file_path, thumbnail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, issueId, type, phase, filePath, thumbnail || null, nowISO());
  return id;
}

export function getMediaForIssue(issueId: string): IssueMedia[] {
  ensureTables();
  const db = getDb();
  return db.prepare('SELECT * FROM issue_media WHERE issue_id = ? ORDER BY created_at').all(issueId) as IssueMedia[];
}

// ===
// COMMENTS CRUD
// ===

export function addComment(issueId: string, authorId: number, authorName: string, text: string): string {
  ensureTables();
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO issue_comments (id, issue_id, author_id, author_name, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, issueId, authorId, authorName, text, nowISO());
  return id;
}

export function getCommentsForIssue(issueId: string): IssueComment[] {
  ensureTables();
  const db = getDb();
  return db.prepare('SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at').all(issueId) as IssueComment[];
}

// ===
// EQUIPMENT CRUD
// ===

export function createEquipment(data: {
  name: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  location: string;
  location_detail?: string;
  purchase_date?: string;
  purchase_cost?: number;
  warranty_expires?: string;
  vendor_name?: string;
  vendor_contact?: string;
}): string {
  ensureTables();
  const db = getDb();
  const id = randomUUID();
  const qr = randomUUID();
  const ts = nowISO();
  db.prepare(`
    INSERT INTO issues_equipment (id, name, brand, model, serial_number, location, location_detail,
      purchase_date, purchase_cost, warranty_expires, vendor_name, vendor_contact,
      qr_code, total_repair_cost, repair_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(
    id, data.name, data.brand || null, data.model || null, data.serial_number || null,
    data.location, data.location_detail || null,
    data.purchase_date || null, data.purchase_cost || null,
    data.warranty_expires || null, data.vendor_name || null, data.vendor_contact || null,
    qr, ts, ts
  );
  return id;
}

export function getEquipment(id: string): Equipment | null {
  ensureTables();
  const db = getDb();
  const row = db.prepare('SELECT * FROM issues_equipment WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parseEquipment(row) : null;
}

export function getEquipmentByQR(qrCode: string): Equipment | null {
  ensureTables();
  const db = getDb();
  const row = db.prepare('SELECT * FROM issues_equipment WHERE qr_code = ?').get(qrCode) as Record<string, unknown> | undefined;
  return row ? parseEquipment(row) : null;
}

export function listEquipment(filters?: { location?: string; search?: string }): Equipment[] {
  ensureTables();
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters?.location) { where.push('location = ?'); params.push(filters.location); }
  if (filters?.search) {
    where.push('(name LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ?)');
    const s = '%' + filters.search + '%';
    params.push(s, s, s, s);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM issues_equipment ${whereClause} ORDER BY location, name`).all(...params) as Record<string, unknown>[];
  return rows.map(parseEquipment);
}

export function updateEquipment(id: string, data: Partial<{
  name: string;
  brand: string;
  model: string;
  serial_number: string;
  location: string;
  location_detail: string;
  purchase_date: string;
  purchase_cost: number;
  warranty_expires: string;
  vendor_name: string;
  vendor_contact: string;
  odoo_equipment_id: number;
}>): void {
  ensureTables();
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) { sets.push(`${key} = ?`); vals.push(val); }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?'); vals.push(nowISO());
  vals.push(id);
  db.prepare(`UPDATE issues_equipment SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getEquipmentDocs(equipmentId: string): EquipmentDoc[] {
  ensureTables();
  const db = getDb();
  return db.prepare('SELECT * FROM issues_equipment_docs WHERE equipment_id = ?').all(equipmentId) as EquipmentDoc[];
}

export function addEquipmentDoc(equipmentId: string, name: string, filePath: string, docType: string): string {
  ensureTables();
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO issues_equipment_docs (id, equipment_id, name, file_path, doc_type) VALUES (?, ?, ?, ?, ?)')
    .run(id, equipmentId, name, filePath, docType);
  return id;
}

export function getEquipmentPhotos(equipmentId: string): EquipmentPhoto[] {
  ensureTables();
  const db = getDb();
  return db.prepare('SELECT * FROM issues_equipment_photos WHERE equipment_id = ?').all(equipmentId) as EquipmentPhoto[];
}

export function addEquipmentPhoto(equipmentId: string, filePath: string, photoType: string, thumbnail?: string): string {
  ensureTables();
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO issues_equipment_photos (id, equipment_id, photo_type, file_path, thumbnail) VALUES (?, ?, ?, ?, ?)')
    .run(id, equipmentId, photoType, filePath, thumbnail || null);
  return id;
}

/** Get repair history for a specific piece of equipment. */
export function getEquipmentRepairHistory(equipmentId: string): Issue[] {
  ensureTables();
  const db = getDb();
  const rows = db.prepare(`
    SELECT i.*,
      (SELECT name FROM portal_users WHERE id = i.reporter_id) as reporter_name
    FROM issues i
    WHERE i.equipment_id = ? AND i.type = 'repair'
    ORDER BY i.created_at DESC
  `).all(equipmentId) as Record<string, unknown>[];
  return rows.map(parseIssueBasic);
}

// ===
// DASHBOARD
// ===

export function getDashboardData(userId: number, userRole: string, userLocation: string): IssuesDashboardData {
  ensureTables();
  const db = getDb();
  const isManager = userRole === 'manager' || userRole === 'admin';
  const loc = userLocation + '%';

  // Active count: non-resolved issues at user's location (respecting visibility)
  let activeCnt: number;
  if (isManager) {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM issues
      WHERE location LIKE ? AND status NOT IN ('resolved', 'rejected')
    `).get(loc) as { cnt: number };
    activeCnt = row.cnt;
  } else {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM issues
      WHERE location LIKE ? AND status NOT IN ('resolved', 'rejected')
        AND (restricted = 0 OR reporter_id = ?)
    `).get(loc, userId) as { cnt: number };
    activeCnt = row.cnt;
  }

  let needsAction = 0;
  if (isManager) {
    const naRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM issues
      WHERE location LIKE ? AND status = 'open' AND assigned_to IS NULL
    `).get(loc) as { cnt: number };
    needsAction = naRow.cnt;
  }

  let restrictedCount = 0;
  if (isManager) {
    const rRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM issues
      WHERE location LIKE ? AND restricted = 1 AND status NOT IN ('resolved', 'rejected')
    `).get(loc) as { cnt: number };
    restrictedCount = rRow.cnt;
  }

  const eqRow = db.prepare('SELECT COUNT(*) as cnt FROM issues_equipment').get() as { cnt: number };
  const recent = getLocationFeed(userLocation, userId, userRole).slice(0, 5);

  return {
    active_count: activeCnt,
    needs_action: needsAction,
    restricted_count: restrictedCount,
    equipment_count: eqRow.cnt,
    recent,
  };
}

// ===
// PARSERS
// ===

function parseIssueWithTypeData(row: Record<string, unknown>): Issue & { type_data: IssueTypeData } {
  return {
    ...parseIssueBasic(row),
    equipment_name: row.equipment_name as string | undefined,
    type_data: row.type_data_json ? JSON.parse(row.type_data_json as string) : {},
  };
}

function parseIssueBasic(row: Record<string, unknown>): Issue {
  return {
    id: row.id as string,
    type: row.type as IssueType,
    status: row.status as IssueStatus,
    urgency: row.urgency as Urgency,
    title: row.title as string,
    description: row.description as string,
    location: row.location as string,
    location_custom: row.location_custom as string | null,
    department: row.department as string,
    reporter_id: row.reporter_id as number,
    reporter_name: row.reporter_name as string | undefined,
    assigned_to: row.assigned_to as string | null,
    priority: row.priority as Priority,
    deadline: row.deadline as string | null,
    equipment_text: row.equipment_text as string | null,
    equipment_id: row.equipment_id as string | null,
    restricted: !!(row.restricted as number),
    manager_notes: row.manager_notes as string | null,
    resolution: row.resolution as string | null,
    repair_cost: row.repair_cost as number | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function parseEquipment(row: Record<string, unknown>): Equipment {
  return {
    id: row.id as string,
    name: row.name as string,
    brand: row.brand as string | null,
    model: row.model as string | null,
    serial_number: row.serial_number as string | null,
    location: row.location as string,
    location_detail: row.location_detail as string | null,
    purchase_date: row.purchase_date as string | null,
    purchase_cost: row.purchase_cost as number | null,
    warranty_expires: row.warranty_expires as string | null,
    vendor_name: row.vendor_name as string | null,
    vendor_contact: row.vendor_contact as string | null,
    qr_code: row.qr_code as string,
    odoo_equipment_id: row.odoo_equipment_id as number | null,
    total_repair_cost: (row.total_repair_cost as number) || 0,
    repair_count: (row.repair_count as number) || 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Inventory Module — SQLite Schema & CRUD
 *
 * Counting templates, sessions, and entries live here.
 * Odoo remains source of truth for products, locations, and stock.quant.
 * On approval, the API route writes inventory_quantity to Odoo.
 */
import { getDb } from './db';
import { berlinToday, berlinWeekday } from './berlin-date';
import type {
  CountingTemplate, CountingSession, CountEntry, QuickCount,
  Frequency, AssignType, SessionStatus,
  CountLocation, ProductPlacement, CountMode,
  TemplatePlacement, SessionCountItem, StockReceipt, ProductImage,
} from '@/types/inventory';

// ===
// SCHEMA INIT
// ===

export function initInventoryTables() {
  const db = getDb();
  // The CREATE block runs as ONE exec; if a single statement fails on a legacy DB
  // (e.g. an index over a column an old table predates) it must NOT stop the column
  // migrations below from running. Catch, log, and always continue to migrate.
  try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS counting_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'adhoc',
      schedule_days TEXT NOT NULL DEFAULT '[]',
      location_id INTEGER NOT NULL,
      company_id INTEGER,
      category_ids TEXT NOT NULL DEFAULT '[]',
      product_ids TEXT NOT NULL DEFAULT '[]',
      assign_type TEXT,
      assign_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counting_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES counting_templates(id),
      scheduled_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      location_id INTEGER NOT NULL,
      company_id INTEGER,
      assigned_user_id INTEGER,
      submitted_at TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS count_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES counting_sessions(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      counted_qty REAL NOT NULL,
      system_qty REAL,
      diff REAL,
      uom TEXT NOT NULL DEFAULT 'Units',
      notes TEXT,
      counted_by INTEGER NOT NULL,
      counted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quick_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      company_id INTEGER,
      counted_qty REAL NOT NULL,
      uom TEXT NOT NULL DEFAULT 'Units',
      counted_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL,
      reviewed_by INTEGER,
      reviewed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_template ON counting_sessions(template_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON counting_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_date ON counting_sessions(scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_entries_session ON count_entries(session_id);
    CREATE INDEX IF NOT EXISTS idx_entries_product ON count_entries(product_id);
    CREATE INDEX IF NOT EXISTS idx_quick_status ON quick_counts(status);
    CREATE INDEX IF NOT EXISTS idx_quick_product ON quick_counts(product_id);
    CREATE INDEX IF NOT EXISTS idx_quick_counted_by ON quick_counts(counted_by);

    CREATE TABLE IF NOT EXISTS product_drafts (
      odoo_product_id INTEGER PRIMARY KEY,
      barcode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_flags (
      odoo_product_id INTEGER PRIMARY KEY,
      requires_photo  INTEGER NOT NULL DEFAULT 0,
      updated_by      INTEGER,
      updated_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS count_photos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      photo        TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_count_photos_source ON count_photos(source_table, source_id);

    CREATE TABLE IF NOT EXISTS count_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'area',
      description TEXT,
      photo TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      odoo_location_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_locations (
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      shelf_sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (odoo_product_id, count_location_id)
    );

    CREATE INDEX IF NOT EXISTS idx_count_locations_company ON count_locations(company_id);
    CREATE INDEX IF NOT EXISTS idx_count_locations_parent ON count_locations(parent_id);
    CREATE INDEX IF NOT EXISTS idx_product_locations_loc ON product_locations(count_location_id);

    CREATE TABLE IF NOT EXISTS session_location_status (
      session_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      skip_reason TEXT,
      updated_at TEXT,
      PRIMARY KEY (session_id, count_location_id)
    );

    CREATE TABLE IF NOT EXISTS location_kinds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT,
      UNIQUE(company_id, kind)
    );
  `);
  } catch (e) {
    console.error('[krawings_inventory] table/index init error (continuing to migrate):', e instanceof Error ? e.message : e);
  }
  migrateInventorySchema(db);
}

// ===
// PRODUCT DRAFTS (scan-to-create tracking)
// ===
// A product is considered a "pending draft awaiting manager review" only if
// it was created via the portal's scan-to-count flow AND is still inactive in
// Odoo. Without this table, barcode-lookup would mistake any archived-with-
// barcode product for a draft.

export function registerDraftProduct(odooProductId: number, barcode: string, createdBy: number) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO product_drafts (odoo_product_id, barcode, created_by, created_at)
    VALUES (?, ?, ?, ?)
  `).run(odooProductId, barcode, createdBy, now());
}

export function isDraftProduct(odooProductId: number): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT 1 FROM product_drafts WHERE odoo_product_id = ? AND status = 'pending'`).get(odooProductId);
  return !!row;
}

/** Mark a draft resolved so it stops surfacing as a pending scan. */
export function markDraftStatus(odooProductId: number, status: 'rejected' | 'linked' | 'approved'): void {
  const db = getDb();
  db.prepare(`UPDATE product_drafts SET status = ? WHERE odoo_product_id = ?`).run(status, odooProductId);
}

function now(): string {
  return new Date().toISOString();
}

function todayStr(): string {
  // Berlin day boundary so it matches restaurant local time (see berlin-date.ts)
  return berlinToday();
}

// ===
// SCHEMA MIGRATIONS
// ===

function migrateInventorySchema(db: ReturnType<typeof getDb>) {
  // Sessions migrations
  const sessCols = db.prepare("PRAGMA table_info('counting_sessions')").all() as { name: string }[];
  const sessColNames = sessCols.map(c => c.name);
  if (!sessColNames.includes('proof_photo')) {
    db.exec("ALTER TABLE counting_sessions ADD COLUMN proof_photo TEXT");
  }

  // Template migrations
  const tmplCols = db.prepare("PRAGMA table_info('counting_templates')").all() as { name: string }[];
  const tmplColNames = tmplCols.map(c => c.name);
  if (!tmplColNames.includes('schedule_days')) {
    db.exec("ALTER TABLE counting_templates ADD COLUMN schedule_days TEXT NOT NULL DEFAULT '[]'");
  }
  // Which restaurant a list belongs to — lets a shared department tablet (one
  // company-scoped staff account) see lists that aren't assigned to a specific
  // person. Nullable: legacy lists stay person-only until re-saved.
  if (!tmplColNames.includes('company_id')) {
    db.exec("ALTER TABLE counting_templates ADD COLUMN company_id INTEGER");
  }

  // Snapshot the company onto each session at creation, so later editing a
  // template's company can never re-tag historical sessions' visibility/routing.
  const sessCols2 = db.prepare("PRAGMA table_info('counting_sessions')").all() as { name: string }[];
  if (!sessCols2.some(c => c.name === 'company_id')) {
    db.exec("ALTER TABLE counting_sessions ADD COLUMN company_id INTEGER");
    // Backfill existing sessions from their template's current company.
    db.exec(`
      UPDATE counting_sessions
      SET company_id = (SELECT t.company_id FROM counting_templates t WHERE t.id = counting_sessions.template_id)
      WHERE company_id IS NULL
    `);
  }

  // Crate/multi-UoM migrations — portal-side crate size + count-line split.
  // All additive & nullable: existing rows keep working (missing = no crate).
  const pfCols = db.prepare("PRAGMA table_info('product_flags')").all() as { name: string }[];
  if (!pfCols.some(c => c.name === 'units_per_crate')) {
    db.exec("ALTER TABLE product_flags ADD COLUMN units_per_crate REAL");
  }
  if (!pfCols.some(c => c.name === 'pack_label')) {
    // The word staff count in: 'crate', 'bunch', 'piece', 'tray'… (null = 'pack').
    db.exec("ALTER TABLE product_flags ADD COLUMN pack_label TEXT");
  }
  for (const table of ['count_entries', 'quick_counts']) {
    const cols = (db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('crate_qty')) db.exec(`ALTER TABLE ${table} ADD COLUMN crate_qty REAL`);
    if (!cols.includes('loose_qty')) db.exec(`ALTER TABLE ${table} ADD COLUMN loose_qty REAL`);
    if (!cols.includes('units_per_crate')) db.exec(`ALTER TABLE ${table} ADD COLUMN units_per_crate REAL`);
  }

  // quick_counts company ownership — nullable: a synchronous SQLite migration
  // can't derive the company from the Odoo location, so it's stamped on new
  // counts and lazily backfilled from Odoo for legacy rows. Un-backfilled
  // (null-company) rows stay quarantined — hidden from non-admin review and
  // approvable only by an unrestricted admin.
  const qcCols = (db.prepare("PRAGMA table_info('quick_counts')").all() as { name: string }[]).map(c => c.name);
  if (!qcCols.includes('company_id')) {
    try { db.exec('ALTER TABLE quick_counts ADD COLUMN company_id INTEGER'); }
    catch (e) { if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e; }
  }
  // Index created HERE — after the column is guaranteed to exist for both fresh
  // and migrated databases. Never in the CREATE-TABLE block, which on a legacy DB
  // runs before this ALTER (a CREATE TABLE IF NOT EXISTS won't add the column).
  db.exec('CREATE INDEX IF NOT EXISTS idx_quick_company ON quick_counts(company_id)');

  // product_drafts lifecycle status (pending → rejected/linked/approved) so a
  // resolved draft stops surfacing as a pending scan.
  const pdCols = (db.prepare("PRAGMA table_info('product_drafts')").all() as { name: string }[]).map(c => c.name);
  if (!pdCols.includes('status')) {
    try { db.exec("ALTER TABLE product_drafts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"); }
    catch (e) { if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e; }
  }

  // ===
  // Location-counting redesign (2026-07-19): multi-spot counting, out-of-stock
  // vs not-counted, explicit pack/loose count mode. All additive &
  // nullable/defaulted — legacy rows and open sessions keep working (a missing
  // value = legacy single-location / inferred behaviour).
  // ===

  // product_flags: explicit count mode + the single-unit ("loose") word.
  const pfCols2 = (db.prepare("PRAGMA table_info('product_flags')").all() as { name: string }[]).map(c => c.name);
  if (!pfCols2.includes('count_mode')) db.exec("ALTER TABLE product_flags ADD COLUMN count_mode TEXT");   // 'simple' | 'pack_loose' (null = legacy infer)
  if (!pfCols2.includes('loose_label')) db.exec("ALTER TABLE product_flags ADD COLUMN loose_label TEXT"); // e.g. 'bottles'

  // count_entries: spot identity, out-of-stock, unit snapshots, converted Odoo qty.
  const ceCols = (db.prepare("PRAGMA table_info('count_entries')").all() as { name: string }[]).map(c => c.name);
  if (!ceCols.includes('count_location_id')) db.exec("ALTER TABLE count_entries ADD COLUMN count_location_id INTEGER NOT NULL DEFAULT 0");
  if (!ceCols.includes('out_of_stock')) db.exec("ALTER TABLE count_entries ADD COLUMN out_of_stock INTEGER NOT NULL DEFAULT 0");
  if (!ceCols.includes('count_mode')) db.exec("ALTER TABLE count_entries ADD COLUMN count_mode TEXT");
  if (!ceCols.includes('pack_label')) db.exec("ALTER TABLE count_entries ADD COLUMN pack_label TEXT");
  if (!ceCols.includes('loose_label')) db.exec("ALTER TABLE count_entries ADD COLUMN loose_label TEXT");
  if (!ceCols.includes('odoo_qty')) {
    db.exec("ALTER TABLE count_entries ADD COLUMN odoo_qty REAL");
    // One-time backfill: legacy rows wrote counted_qty to Odoo — preserve that.
    // Guarded by the column-add so future portal-only (null) rows are never clobbered.
    db.exec("UPDATE count_entries SET odoo_qty = counted_qty WHERE odoo_qty IS NULL");
  }

  // quick_counts: out-of-stock + unit snapshots + converted Odoo qty.
  const qc2Cols = (db.prepare("PRAGMA table_info('quick_counts')").all() as { name: string }[]).map(c => c.name);
  if (!qc2Cols.includes('out_of_stock')) db.exec("ALTER TABLE quick_counts ADD COLUMN out_of_stock INTEGER NOT NULL DEFAULT 0");
  if (!qc2Cols.includes('count_mode')) db.exec("ALTER TABLE quick_counts ADD COLUMN count_mode TEXT");
  if (!qc2Cols.includes('pack_label')) db.exec("ALTER TABLE quick_counts ADD COLUMN pack_label TEXT");
  if (!qc2Cols.includes('loose_label')) db.exec("ALTER TABLE quick_counts ADD COLUMN loose_label TEXT");
  if (!qc2Cols.includes('odoo_qty')) {
    db.exec("ALTER TABLE quick_counts ADD COLUMN odoo_qty REAL");
    db.exec("UPDATE quick_counts SET odoo_qty = counted_qty WHERE odoo_qty IS NULL");
  }

  // Per-list placements: a product sits at one or more spots WITHIN a specific
  // list (template). Global product_locations stays for legacy/default physical
  // placement; the builder writes here so editing one list never touches another.
  db.exec(`
    CREATE TABLE IF NOT EXISTS template_product_locations (
      template_id INTEGER NOT NULL,
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      shelf_sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (template_id, odoo_product_id, count_location_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tpl_placements_tpl ON template_product_locations(template_id)');

  // Per-session snapshot of what to count and where, frozen at session creation,
  // so editing a template/placement mid-count never re-routes an open session.
  // Legacy sessions have no rows here and fall back to live template resolution.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_count_items (
      session_id INTEGER NOT NULL,
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      shelf_sort INTEGER NOT NULL DEFAULT 0,
      requires_photo INTEGER NOT NULL DEFAULT 0,
      count_mode TEXT,
      pack_label TEXT,
      loose_label TEXT,
      units_per_crate REAL,
      PRIMARY KEY (session_id, odoo_product_id, count_location_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_session_items_session ON session_count_items(session_id)');

  // One count row per (session, spot, product). Try UNIQUE; if a legacy DB has
  // duplicate (session, product) rows at the default spot 0, fall back to a
  // non-unique index and warn rather than crash startup (app-layer upsert keys
  // on the triple regardless).
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_session_loc_product ON count_entries(session_id, count_location_id, product_id)');
  } catch (e) {
    console.warn('[inventory] duplicate legacy count rows — using non-unique (session,location,product) index', e);
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_session_loc_product ON count_entries(session_id, count_location_id, product_id)');
  }

  // Goods received ("purchased-in") — portal-owned; feeds the opening + received
  // − closing consumption report. No Odoo.
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL DEFAULT 0,
      qty_base REAL NOT NULL,
      crate_qty REAL,
      loose_qty REAL,
      units_per_crate REAL,
      uom TEXT NOT NULL DEFAULT 'Units',
      note TEXT,
      photo TEXT,
      received_by INTEGER NOT NULL,
      received_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_receipts_company ON stock_receipts(company_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_receipts_product ON stock_receipts(odoo_product_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_receipts_received_at ON stock_receipts(received_at)');

  // Product pictures (one primary image per product) — portal-owned, set by
  // camera or upload. Keyed by product id (metadata, like product_flags).
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_images (
      odoo_product_id INTEGER PRIMARY KEY,
      image TEXT NOT NULL,
      mime TEXT,
      updated_by INTEGER,
      updated_at TEXT
    )
  `);
}

// ===
// SCHEDULE HELPERS
// ===

/**
 * Check if a template should auto-generate a session for today.
 * - daily: always yes
 * - weekly: only if today's weekday is in schedule_days
 * - monthly: not yet implemented (returns false)
 * - adhoc: never auto-generate
 */
function shouldGenerateToday(tmpl: CountingTemplate): boolean {
  if (tmpl.frequency === 'daily') return true;
  if (tmpl.frequency === 'weekly') {
    const dayOfWeek = berlinWeekday(); // Berlin weekday, consistent with todayStr()
    const days = tmpl.schedule_days || [];
    // If no days configured, don't generate (misconfigured template)
    if (days.length === 0) return false;
    return days.includes(dayOfWeek);
  }
  // adhoc + monthly: no auto-generation
  return false;
}

// ===
// TEMPLATES CRUD
// ===

export function createTemplate(data: {
  name: string;
  frequency: Frequency;
  schedule_days?: number[];
  location_id: number;
  company_id?: number | null;
  category_ids: number[];
  product_ids?: number[];
  assign_type: AssignType;
  assign_id: number | null;
  created_by: number;
}): number {
  const db = getDb();
  const ts = now();
  const r = db.prepare(`
    INSERT INTO counting_templates (name, frequency, schedule_days, location_id, company_id, category_ids, product_ids, assign_type, assign_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.name, data.frequency, JSON.stringify(data.schedule_days || []),
    data.location_id, data.company_id ?? null,
    JSON.stringify(data.category_ids), JSON.stringify(data.product_ids || []),
    data.assign_type, data.assign_id, data.created_by, ts, ts
  );
  return r.lastInsertRowid as number;
}

export function updateTemplate(id: number, data: Partial<{
  name: string;
  frequency: Frequency;
  schedule_days: number[];
  location_id: number;
  company_id: number | null;
  category_ids: number[];
  product_ids: number[];
  assign_type: AssignType;
  assign_id: number | null;
  active: boolean;
}>) {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.frequency !== undefined) { sets.push('frequency = ?'); vals.push(data.frequency); }
  if (data.schedule_days !== undefined) { sets.push('schedule_days = ?'); vals.push(JSON.stringify(data.schedule_days)); }
  if (data.location_id !== undefined) { sets.push('location_id = ?'); vals.push(data.location_id); }
  if (data.company_id !== undefined) { sets.push('company_id = ?'); vals.push(data.company_id); }
  if (data.category_ids !== undefined) { sets.push('category_ids = ?'); vals.push(JSON.stringify(data.category_ids)); }
  if (data.product_ids !== undefined) { sets.push('product_ids = ?'); vals.push(JSON.stringify(data.product_ids)); }
  if (data.assign_type !== undefined) { sets.push('assign_type = ?'); vals.push(data.assign_type); }
  if (data.assign_id !== undefined) { sets.push('assign_id = ?'); vals.push(data.assign_id); }
  if (data.active !== undefined) { sets.push('active = ?'); vals.push(data.active ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?'); vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE counting_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getTemplate(id: number): CountingTemplate | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT t.*, u.name as assign_label
    FROM counting_templates t
    LEFT JOIN portal_users u ON u.id = t.assign_id AND t.assign_type = 'person'
    WHERE t.id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? parseTemplate(row) : null;
}

export function listTemplates(filters?: { location_id?: number; active?: boolean; company_ids?: number[] }): CountingTemplate[] {
  const db = getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters?.location_id) { where.push('t.location_id = ?'); vals.push(filters.location_id); }
  if (filters?.active !== undefined) { where.push('t.active = ?'); vals.push(filters.active ? 1 : 0); }
  // Scope to a set of restaurants (for the manager-facing list). Legacy lists
  // with no company stay visible so a manager can re-save to tag them.
  if (filters?.company_ids) {
    if (filters.company_ids.length > 0) {
      const ph = filters.company_ids.map(() => '?').join(',');
      where.push(`(t.company_id IN (${ph}) OR t.company_id IS NULL)`);
      vals.push(...filters.company_ids);
    } else {
      where.push('t.company_id IS NULL');
    }
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT t.*, u.name as assign_label
    FROM counting_templates t
    LEFT JOIN portal_users u ON u.id = t.assign_id AND t.assign_type = 'person'
    ${clause}
    ORDER BY t.updated_at DESC
  `).all(...vals) as Record<string, unknown>[];
  return rows.map(parseTemplate);
}

function parseTemplate(row: Record<string, unknown>): CountingTemplate {
  return {
    ...(row as unknown as CountingTemplate),
    category_ids: JSON.parse((row.category_ids as string) || '[]'),
    product_ids: JSON.parse((row.product_ids as string) || '[]'),
    schedule_days: JSON.parse((row.schedule_days as string) || '[]'),
    active: !!row.active,
  };
}

// ===
// SESSIONS CRUD
// ===

export function createSession(data: {
  template_id: number;
  scheduled_date: string;
  location_id: number;
  assigned_user_id?: number | null;
  company_id?: number | null;
}): number {
  const db = getDb();
  // Snapshot the company at creation; derive from the template when the caller
  // didn't pass it (so the session's company never shifts if the template is
  // later re-tagged).
  const companyId = data.company_id !== undefined
    ? data.company_id
    : (getTemplate(data.template_id)?.company_id ?? null);
  const r = db.prepare(`
    INSERT INTO counting_sessions (template_id, scheduled_date, location_id, company_id, assigned_user_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(data.template_id, data.scheduled_date, data.location_id, companyId, data.assigned_user_id || null, now());
  const sessionId = r.lastInsertRowid as number;
  // Freeze what/where to count now. Best-effort: a failure never blocks session
  // creation — such a session simply has no snapshot and falls back to live
  // template resolution when read.
  try { snapshotSessionFromTemplate(sessionId, data.template_id); }
  catch (e) { console.error('[inventory] session snapshot failed (using live resolution):', e); }
  return sessionId;
}

export function listSessions(filters?: {
  status?: SessionStatus;
  template_id?: number;
  location_id?: number;
  assigned_user_id?: number;
  scheduled_date?: string;
  // Manager/admin visibility: restrict to these companies (excludes null-company
  // legacy sessions). Omit for an unrestricted admin (no company filter).
  company_ids?: number[];
  // Staff visibility: a session is shown when it's assigned to this user, OR
  // it's not assigned to any person AND belongs to one of the user's companies
  // (how a shared department tablet sees "Anyone"/department lists).
  visibleTo?: { userId: number; companyIds: number[] };
}): CountingSession[] {
  const db = getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters?.status) { where.push('s.status = ?'); vals.push(filters.status); }
  if (filters?.template_id) { where.push('s.template_id = ?'); vals.push(filters.template_id); }
  if (filters?.location_id) { where.push('s.location_id = ?'); vals.push(filters.location_id); }
  if (filters?.assigned_user_id) { where.push('s.assigned_user_id = ?'); vals.push(filters.assigned_user_id); }
  if (filters?.company_ids) {
    if (filters.company_ids.length === 0) where.push('0 = 1');
    else { where.push(`s.company_id IN (${filters.company_ids.map(() => '?').join(',')})`); vals.push(...filters.company_ids); }
  }
  if (filters?.visibleTo) {
    const { userId, companyIds } = filters.visibleTo;
    if (companyIds.length > 0) {
      const ph = companyIds.map(() => '?').join(',');
      where.push(`(s.assigned_user_id = ? OR (s.assigned_user_id IS NULL AND s.company_id IN (${ph})))`);
      vals.push(userId, ...companyIds);
    } else {
      where.push('s.assigned_user_id = ?');
      vals.push(userId);
    }
  }
  if (filters?.scheduled_date) { where.push('s.scheduled_date = ?'); vals.push(filters.scheduled_date); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`
    SELECT s.*, t.name as template_name, t.frequency as template_frequency,
           t.product_ids as template_product_ids, t.category_ids as template_category_ids,
           s.company_id as company_id,
           u.name as assigned_user_name
    FROM counting_sessions s
    LEFT JOIN counting_templates t ON t.id = s.template_id
    LEFT JOIN portal_users u ON u.id = s.assigned_user_id
    ${clause}
    ORDER BY s.scheduled_date DESC
  `).all(...vals) as CountingSession[];
}

export function getSession(id: number): CountingSession | null {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, t.name as template_name, t.frequency as template_frequency,
           t.product_ids as template_product_ids, t.category_ids as template_category_ids,
           s.company_id as company_id,
           u.name as assigned_user_name
    FROM counting_sessions s
    LEFT JOIN counting_templates t ON t.id = s.template_id
    LEFT JOIN portal_users u ON u.id = s.assigned_user_id
    WHERE s.id = ?
  `).get(id) as CountingSession | null;
}

export function saveSessionProofPhoto(id: number, photo: string) {
  const db = getDb();
  db.prepare('UPDATE counting_sessions SET proof_photo = ? WHERE id = ?').run(photo, id);
}

export function updateSessionStatus(id: number, status: SessionStatus, extra?: {
  reviewed_by?: number;
  review_note?: string;
  fromStatus?: string | string[];   // when set, only transition from these states (atomic guard)
}): number {
  const db = getDb();
  const ts = now();
  const from = extra?.fromStatus == null ? null : (Array.isArray(extra.fromStatus) ? extra.fromStatus : [extra.fromStatus]);
  const guard = from ? ` AND status IN (${from.map(() => '?').join(',')})` : '';
  const gv = from || [];
  if (status === 'submitted') {
    return db.prepare(`UPDATE counting_sessions SET status = ?, submitted_at = ? WHERE id = ?${guard}`)
      .run(status, ts, id, ...gv).changes as number;
  } else if (status === 'approved' || status === 'rejected') {
    return db.prepare(`UPDATE counting_sessions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?${guard}`)
      .run(status, extra?.reviewed_by || null, ts, extra?.review_note || null, id, ...gv).changes as number;
  } else {
    return db.prepare(`UPDATE counting_sessions SET status = ? WHERE id = ?${guard}`)
      .run(status, id, ...gv).changes as number;
  }
}

/**
 * Generate counting sessions for today from all active templates.
 * Respects frequency + schedule_days:
 * - daily: generates every day
 * - weekly: only on days listed in schedule_days
 * - adhoc/monthly: skipped (adhoc = manual, monthly = not yet implemented)
 * Skips templates that already have a session for today.
 */
export function generateTodaySessions(companyIds?: number[]): { created: number; skipped: number } {
  const db = getDb();
  const today = todayStr();

  const templates = listTemplates({ active: true });
  let created = 0;
  let skipped = 0;

  for (const tmpl of templates) {
    // Scope generation to the requester's restaurant(s) when given, so one
    // company's session-list load can't spawn another company's sessions.
    // (undefined = unrestricted, e.g. an admin or an internal call.)
    if (companyIds && !(tmpl.company_id != null && companyIds.includes(tmpl.company_id))) {
      skipped++;
      continue;
    }
    // Check if this template should generate today based on frequency + schedule
    if (!shouldGenerateToday(tmpl)) {
      skipped++;
      continue;
    }

    const existing = db.prepare(
      'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
    ).get(tmpl.id, today);

    if (existing) {
      skipped++;
      continue;
    }

    let assignedUserId: number | null = null;
    if (tmpl.assign_type === 'person' && tmpl.assign_id) {
      assignedUserId = tmpl.assign_id;
    }

    createSession({
      template_id: tmpl.id,
      scheduled_date: today,
      location_id: tmpl.location_id,
      company_id: tmpl.company_id ?? null,
      assigned_user_id: assignedUserId,
    });
    created++;
  }

  return { created, skipped };
}

/**
 * Generate a single session for today from a specific template.
 * Respects frequency + schedule_days.
 * Returns the session ID, or null if not scheduled today or already exists.
 */
export function generateSessionForTemplate(templateId: number): number | null {
  const db = getDb();
  const today = todayStr();

  const tmpl = getTemplate(templateId);
  if (!tmpl || !tmpl.active) return null;

  // Check if this template should generate today
  if (!shouldGenerateToday(tmpl)) return null;

  const existing = db.prepare(
    'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
  ).get(templateId, today) as { id: number } | undefined;

  if (existing) return existing.id;

  let assignedUserId: number | null = null;
  if (tmpl.assign_type === 'person' && tmpl.assign_id) {
    assignedUserId = tmpl.assign_id;
  }

  return createSession({
    template_id: templateId,
    scheduled_date: today,
    location_id: tmpl.location_id,
    company_id: tmpl.company_id ?? null,
    assigned_user_id: assignedUserId,
  });
}

// ===
// COUNT ENTRIES
// ===

export function upsertCountEntry(data: {
  session_id: number;
  product_id: number;
  count_location_id?: number;        // which spot (default 0 = no specific spot / legacy)
  counted_qty: number;               // base-unit total (bottles); forced to 0 when out_of_stock
  out_of_stock?: boolean;            // deliberate "none here" (≠ a counted 0, ≠ not-counted)
  system_qty?: number | null;
  uom: string;
  notes?: string;
  counted_by: number;
  crate_qty?: number | null;         // audit trail: crates as entered
  loose_qty?: number | null;         // audit trail: loose base units as entered
  units_per_crate?: number | null;   // snapshot of the crate size at count time
  count_mode?: CountMode | null;     // snapshot of how it was counted
  pack_label?: string | null;        // snapshot
  loose_label?: string | null;       // snapshot
  odoo_qty?: number | null;          // converted base qty safe for Odoo; null = portal-only (no average)
}) {
  const db = getDb();
  const locId = data.count_location_id ?? 0;
  const oos = data.out_of_stock ? 1 : 0;
  const countedQty = oos ? 0 : data.counted_qty;
  // Keyed by (session, spot, product) so the SAME product can be counted at
  // several spots in one session without overwriting itself.
  const existing = db.prepare(
    'SELECT id FROM count_entries WHERE session_id = ? AND count_location_id = ? AND product_id = ?'
  ).get(data.session_id, locId, data.product_id) as { id: number } | undefined;

  const diff = data.system_qty != null ? countedQty - data.system_qty : null;

  // Preserve an existing crate/loose split when a save doesn't carry crate
  // fields (e.g. a photo-only re-save of a crate product). Passing any crate
  // field (even null) is treated as an explicit set/clear.
  const hasCrateData = data.crate_qty !== undefined || data.loose_qty !== undefined || data.units_per_crate !== undefined;
  let crateQty: number | null;
  let looseQty: number | null;
  let upc: number | null;
  if (hasCrateData) {
    crateQty = data.crate_qty ?? null;
    looseQty = data.loose_qty ?? null;
    upc = data.units_per_crate ?? null;
  } else if (existing) {
    const prev = db.prepare('SELECT crate_qty, loose_qty, units_per_crate FROM count_entries WHERE id = ?').get(existing.id) as
      { crate_qty: number | null; loose_qty: number | null; units_per_crate: number | null } | undefined;
    crateQty = prev?.crate_qty ?? null;
    looseQty = prev?.loose_qty ?? null;
    upc = prev?.units_per_crate ?? null;
  } else {
    crateQty = null;
    looseQty = null;
    upc = null;
  }

  const cmode = data.count_mode ?? null;
  const plabel = data.pack_label ?? null;
  const llabel = data.loose_label ?? null;
  // Out = intentional zero for Odoo. Legacy callers (odoo_qty undefined) keep
  // today's behaviour: write the counted qty. A new caller passes null to mean
  // "portal-only, don't touch Odoo kg" (e.g. a simple count with no average).
  const odooQty = oos ? 0 : (data.odoo_qty !== undefined ? data.odoo_qty : countedQty);

  if (existing) {
    db.prepare(`
      UPDATE count_entries SET counted_qty = ?, out_of_stock = ?, system_qty = ?, diff = ?, uom = ?, notes = ?,
        crate_qty = ?, loose_qty = ?, units_per_crate = ?, count_mode = ?, pack_label = ?, loose_label = ?, odoo_qty = ?, counted_at = ?
      WHERE id = ?
    `).run(countedQty, oos, data.system_qty ?? null, diff, data.uom, data.notes || null,
      crateQty, looseQty, upc, cmode, plabel, llabel, odooQty, now(), existing.id);
  } else {
    db.prepare(`
      INSERT INTO count_entries (session_id, product_id, count_location_id, counted_qty, out_of_stock, system_qty, diff, uom, notes,
        crate_qty, loose_qty, units_per_crate, count_mode, pack_label, loose_label, odoo_qty, counted_by, counted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.session_id, data.product_id, locId, countedQty, oos, data.system_qty ?? null, diff, data.uom, data.notes || null,
      crateQty, looseQty, upc, cmode, plabel, llabel, odooQty, data.counted_by, now());
  }
}

/**
 * Delete count rows. With `count_location_id` → just that spot's row for the
 * product; without it → every spot for that product in the session (legacy
 * behaviour, e.g. removing a product entirely).
 */
export function deleteCountEntry(session_id: number, product_id: number, count_location_id?: number) {
  const db = getDb();
  const where = count_location_id !== undefined
    ? 'session_id = ? AND product_id = ? AND count_location_id = ?'
    : 'session_id = ? AND product_id = ?';
  const params: number[] = count_location_id !== undefined
    ? [session_id, product_id, count_location_id]
    : [session_id, product_id];
  // Find the entry ids first so we can delete their photos
  const rows = db.prepare(`SELECT id FROM count_entries WHERE ${where}`).all(...params) as { id: number }[];
  for (const r of rows) deleteCountPhotos('count_entries', r.id);
  db.prepare(`DELETE FROM count_entries WHERE ${where}`).run(...params);
}

export function getSessionEntries(session_id: number): CountEntry[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM count_entries WHERE session_id = ? ORDER BY counted_at DESC')
    .all(session_id) as Record<string, unknown>[];
  return rows.map(r => ({ ...(r as unknown as CountEntry), out_of_stock: !!r.out_of_stock }));
}

// ===
// QUICK COUNTS
// ===

export function createQuickCount(data: {
  product_id: number;
  location_id: number;
  company_id: number;                // which restaurant — drives review scoping
  counted_qty: number;               // always the base-unit total (bottles)
  uom: string;
  counted_by: number;
  crate_qty?: number | null;
  loose_qty?: number | null;
  units_per_crate?: number | null;
}): number {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO quick_counts (product_id, location_id, company_id, counted_qty, uom, counted_by, status, submitted_at,
      crate_qty, loose_qty, units_per_crate)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(data.product_id, data.location_id, data.company_id, data.counted_qty, data.uom, data.counted_by, now(),
    data.crate_qty ?? null, data.loose_qty ?? null, data.units_per_crate ?? null);
  return r.lastInsertRowid as number;
}

export function listQuickCounts(filters?: { status?: string; counted_by?: number; company_ids?: number[] }): QuickCount[] {
  const db = getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters?.status) { where.push('q.status = ?'); vals.push(filters.status); }
  if (filters?.counted_by) { where.push('q.counted_by = ?'); vals.push(filters.counted_by); }
  // Company scope: when the caller is restricted to specific companies, only their
  // rows are visible. A NULL company_id (legacy, not yet backfilled) is excluded by
  // `IN`, so it stays quarantined from non-admins. An explicit empty scope yields no
  // rows; an undefined company_ids (unrestricted admin) applies no company filter.
  if (filters?.company_ids) {
    if (filters.company_ids.length === 0) where.push('0 = 1');
    else { where.push(`q.company_id IN (${filters.company_ids.map(() => '?').join(',')})`); vals.push(...filters.company_ids); }
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`
    SELECT q.*, u.name as counted_by_name
    FROM quick_counts q
    LEFT JOIN portal_users u ON u.id = q.counted_by
    ${clause}
    ORDER BY q.submitted_at DESC
  `).all(...vals) as QuickCount[];
}

/** Approve a PENDING quick count atomically. Returns rows changed (0 = already decided). */
export function approveQuickCount(id: number, reviewed_by: number): number {
  const db = getDb();
  return db.prepare("UPDATE quick_counts SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
    .run(reviewed_by, now(), id).changes as number;
}

/** Reject (discard) a PENDING quick count — never writes to Odoo stock.
 *  Atomic; returns rows changed (0 = already decided). */
export function rejectQuickCount(id: number, reviewed_by: number): number {
  const db = getDb();
  return db.prepare("UPDATE quick_counts SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
    .run(reviewed_by, now(), id).changes as number;
}

/** Distinct Odoo location ids of quick counts still missing a company (for lazy backfill). */
export function getQuickCountLocationsMissingCompany(): number[] {
  const db = getDb();
  return (db.prepare('SELECT DISTINCT location_id FROM quick_counts WHERE company_id IS NULL').all() as { location_id: number }[])
    .map(r => r.location_id);
}

/** Stamp `companyId` on legacy quick counts of `locationId` that were missing it. Returns rows changed. */
export function setQuickCountCompanyByLocation(locationId: number, companyId: number): number {
  const db = getDb();
  return db.prepare('UPDATE quick_counts SET company_id = ? WHERE location_id = ? AND company_id IS NULL')
    .run(companyId, locationId).changes as number;
}

/**
 * Reassign every count line (quick_counts + count_entries) that points to
 * `fromProductId` so it points to `toProductId` instead. Used when a
 * manager links a draft product to an existing product during review.
 *
 * Returns the total number of rows changed.
 */
export function reassignCountsForProduct(fromProductId: number, toProductId: number): number {
  const db = getDb();
  let changed = 0;
  changed += db.prepare('UPDATE quick_counts SET product_id = ? WHERE product_id = ?')
    .run(toProductId, fromProductId).changes;
  changed += db.prepare('UPDATE count_entries SET product_id = ? WHERE product_id = ?')
    .run(toProductId, fromProductId).changes;
  return changed;
}

/**
 * Delete every count line (quick_counts + count_entries) that points to
 * `productId`. Used when a manager rejects a draft product during review.
 *
 * Returns the total number of rows deleted.
 */
export function deleteCountsForProduct(productId: number): number {
  const db = getDb();

  const quickRows = db.prepare(
    'SELECT id FROM quick_counts WHERE product_id = ?'
  ).all(productId) as { id: number }[];
  for (const r of quickRows) deleteCountPhotos('quick_counts', r.id);

  const entryRows = db.prepare(
    'SELECT id FROM count_entries WHERE product_id = ?'
  ).all(productId) as { id: number }[];
  for (const r of entryRows) deleteCountPhotos('count_entries', r.id);

  let deleted = 0;
  deleted += db.prepare('DELETE FROM quick_counts WHERE product_id = ?').run(productId).changes;
  deleted += db.prepare('DELETE FROM count_entries WHERE product_id = ?').run(productId).changes;
  return deleted;
}

// ===
// PRODUCT FLAGS (per-product counting requirements)
// ===

export interface ProductFlag {
  odoo_product_id: number;
  requires_photo: boolean;
  units_per_crate: number | null;  // base units per counted pack/piece; null = count in base units
  pack_label: string | null;       // what staff count in: 'crate' | 'bunch' | 'piece' | 'tray'… (null → 'pack')
  count_mode: CountMode | null;    // 'simple' | 'pack_loose' — null = infer from units_per_crate
  loose_label: string | null;      // single-unit word for pack_loose mode ('bottles'…)
  updated_by: number | null;
  updated_at: string | null;
}

export function getProductFlags(ids?: number[]): ProductFlag[] {
  const db = getDb();
  let rows: any[];
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    rows = db.prepare(
      `SELECT * FROM product_flags WHERE odoo_product_id IN (${placeholders})`
    ).all(...ids);
  } else {
    rows = db.prepare('SELECT * FROM product_flags').all();
  }
  return rows.map(r => ({
    odoo_product_id: r.odoo_product_id,
    requires_photo: !!r.requires_photo,
    units_per_crate: r.units_per_crate != null ? Number(r.units_per_crate) : null,
    pack_label: r.pack_label ?? null,
    count_mode: (r.count_mode as CountMode) ?? null,
    loose_label: r.loose_label ?? null,
    updated_by: r.updated_by,
    updated_at: r.updated_at,
  }));
}

export function setProductFlag(
  productId: number,
  requiresPhoto: boolean,
  userId: number,
) {
  const db = getDb();
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, requires_photo, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      requires_photo = excluded.requires_photo,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, requiresPhoto ? 1 : 0, userId, now());
}

/**
 * Set (or clear) a product's crate size. Pass null to clear it — that product
 * then falls back to counting in base units. Upsert leaves requires_photo
 * untouched (defaults to 0 only when creating a brand-new row).
 */
export function setProductCrateSize(
  productId: number,
  unitsPerCrate: number | null,
  userId: number,
) {
  const db = getDb();
  const size = unitsPerCrate != null && unitsPerCrate > 0 ? unitsPerCrate : null;
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, units_per_crate, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      units_per_crate = excluded.units_per_crate,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, size, userId, now());
}

/**
 * Set a product's explicit count mode + the single-unit ("loose") word.
 * mode = null clears back to legacy inference. Upsert leaves other flag fields
 * (requires_photo, units_per_crate, pack_label) untouched.
 */
export function setProductCountMode(
  productId: number,
  mode: CountMode | null,
  looseLabel: string | null,
  userId: number,
) {
  const db = getDb();
  const loose = looseLabel && looseLabel.trim() ? looseLabel.trim() : null;
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, count_mode, loose_label, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      count_mode = excluded.count_mode,
      loose_label = excluded.loose_label,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, mode, loose, userId, now());
}

// ===
// TEMPLATE PLACEMENTS (product ↔ spot, scoped to ONE list)
// ===

/** Replace all of a template's placements in one transaction. */
export function setTemplatePlacements(
  templateId: number,
  placements: { odoo_product_id: number; count_location_id: number; shelf_sort?: number }[],
): void {
  const db = getDb();
  const tx = db.transaction((rows: typeof placements) => {
    db.prepare('DELETE FROM template_product_locations WHERE template_id = ?').run(templateId);
    const ins = db.prepare(
      'INSERT OR IGNORE INTO template_product_locations (template_id, odoo_product_id, count_location_id, shelf_sort) VALUES (?, ?, ?, ?)',
    );
    rows.forEach((p, i) => ins.run(templateId, p.odoo_product_id, p.count_location_id, p.shelf_sort ?? i));
  });
  tx(placements);
}

/** A template's placements, ordered by spot then shelf. */
export function getTemplatePlacements(templateId: number): TemplatePlacement[] {
  const db = getDb();
  return db.prepare(
    'SELECT template_id, odoo_product_id, count_location_id, shelf_sort FROM template_product_locations WHERE template_id = ? ORDER BY count_location_id, shelf_sort, odoo_product_id',
  ).all(templateId) as TemplatePlacement[];
}

// ===
// SESSION COUNT ITEMS (frozen "what/where to count" snapshot per session)
// ===

/** Freeze a session's items at creation. Replaces any existing snapshot. */
export function snapshotSessionItems(
  sessionId: number,
  items: Omit<SessionCountItem, 'session_id'>[],
): void {
  const db = getDb();
  const tx = db.transaction((rows: typeof items) => {
    db.prepare('DELETE FROM session_count_items WHERE session_id = ?').run(sessionId);
    const ins = db.prepare(`INSERT OR IGNORE INTO session_count_items
      (session_id, odoo_product_id, count_location_id, shelf_sort, requires_photo, count_mode, pack_label, loose_label, units_per_crate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    rows.forEach((it, i) => ins.run(
      sessionId, it.odoo_product_id, it.count_location_id, it.shelf_sort ?? i,
      it.requires_photo ? 1 : 0, it.count_mode ?? null, it.pack_label ?? null,
      it.loose_label ?? null, it.units_per_crate ?? null,
    ));
  });
  tx(items);
}

/**
 * Freeze a session's count items from its template: the template's per-spot
 * placements when present, else the flat product list at the catch-all spot (0)
 * for legacy templates. Captures each product's current unit settings so a later
 * flag/template edit can't change an already-open session.
 */
export function snapshotSessionFromTemplate(sessionId: number, templateId: number): void {
  const tmpl = getTemplate(templateId);
  if (!tmpl) return;
  const placements = getTemplatePlacements(templateId);
  const pairs: { product_id: number; spot: number; shelf: number }[] = [];
  if (placements.length > 0) {
    placements.forEach((p, i) => pairs.push({ product_id: p.odoo_product_id, spot: p.count_location_id, shelf: p.shelf_sort ?? i }));
  } else {
    const pids: number[] = Array.isArray(tmpl.product_ids) ? (tmpl.product_ids as number[]) : [];
    pids.forEach((pid, i) => pairs.push({ product_id: pid, spot: 0, shelf: i }));
  }
  if (pairs.length === 0) return;
  const flagIds = Array.from(new Set(pairs.map(p => p.product_id)));
  const flagMap = new Map(getProductFlags(flagIds).map(f => [f.odoo_product_id, f]));
  snapshotSessionItems(sessionId, pairs.map(p => {
    const f = flagMap.get(p.product_id);
    return {
      odoo_product_id: p.product_id,
      count_location_id: p.spot,
      shelf_sort: p.shelf,
      requires_photo: !!f?.requires_photo,
      count_mode: f?.count_mode ?? null,
      pack_label: f?.pack_label ?? null,
      loose_label: f?.loose_label ?? null,
      units_per_crate: f?.units_per_crate ?? null,
    };
  }));
}

/** A session's snapshotted items (empty for legacy sessions → caller falls back to live resolution). */
export function getSessionItems(sessionId: number): SessionCountItem[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM session_count_items WHERE session_id = ? ORDER BY count_location_id, shelf_sort, odoo_product_id',
  ).all(sessionId) as Record<string, unknown>[];
  return rows.map(r => ({
    session_id: r.session_id as number,
    odoo_product_id: r.odoo_product_id as number,
    count_location_id: r.count_location_id as number,
    shelf_sort: r.shelf_sort as number,
    requires_photo: !!r.requires_photo,
    count_mode: (r.count_mode as CountMode) ?? null,
    pack_label: (r.pack_label as string) ?? null,
    loose_label: (r.loose_label as string) ?? null,
    units_per_crate: r.units_per_crate != null ? Number(r.units_per_crate) : null,
  }));
}

// ===
// GOODS RECEIVED ("purchased-in") — feeds the consumption report
// ===

export function createReceipt(data: {
  company_id: number; odoo_product_id: number; count_location_id?: number;
  qty_base: number; crate_qty?: number | null; loose_qty?: number | null; units_per_crate?: number | null;
  uom?: string; note?: string | null; photo?: string | null; received_by: number; received_at?: string;
}): number {
  const db = getDb();
  const r = db.prepare(`INSERT INTO stock_receipts
    (company_id, odoo_product_id, count_location_id, qty_base, crate_qty, loose_qty, units_per_crate, uom, note, photo, received_by, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.company_id, data.odoo_product_id, data.count_location_id ?? 0, data.qty_base,
      data.crate_qty ?? null, data.loose_qty ?? null, data.units_per_crate ?? null,
      data.uom || 'Units', data.note ?? null, data.photo ?? null, data.received_by, data.received_at || now());
  return r.lastInsertRowid as number;
}

export function listReceipts(filters: { company_ids?: number[]; product_id?: number; from?: string; to?: string; limit?: number }): StockReceipt[] {
  const db = getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters.company_ids) {
    if (filters.company_ids.length === 0) where.push('0 = 1');
    else { where.push(`r.company_id IN (${filters.company_ids.map(() => '?').join(',')})`); vals.push(...filters.company_ids); }
  }
  if (filters.product_id) { where.push('r.odoo_product_id = ?'); vals.push(filters.product_id); }
  if (filters.from) { where.push('r.received_at >= ?'); vals.push(filters.from); }
  if (filters.to) { where.push('r.received_at <= ?'); vals.push(filters.to); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`
    SELECT r.*, u.name AS received_by_name
    FROM stock_receipts r
    LEFT JOIN portal_users u ON u.id = r.received_by
    ${clause}
    ORDER BY r.received_at DESC
    LIMIT ?
  `).all(...vals, filters.limit ?? 500) as StockReceipt[];
}

/** Delete a receipt, bounded to the caller's companies (null = unrestricted admin). Returns rows changed. */
export function deleteReceipt(id: number, companyIds: number[] | null): number {
  const db = getDb();
  if (companyIds && companyIds.length === 0) return 0;
  if (companyIds) {
    const ph = companyIds.map(() => '?').join(',');
    return db.prepare(`DELETE FROM stock_receipts WHERE id = ? AND company_id IN (${ph})`).run(id, ...companyIds).changes as number;
  }
  return db.prepare('DELETE FROM stock_receipts WHERE id = ?').run(id).changes as number;
}

/** Sum received base qty per product over [from, to] for a company set (usage report). */
export function sumReceiptsByProduct(companyIds: number[] | null, from: string, to: string): Record<number, number> {
  const db = getDb();
  const where: string[] = ['received_at >= ?', 'received_at <= ?'];
  const vals: unknown[] = [from, to];
  if (companyIds) {
    if (companyIds.length === 0) return {};
    where.push(`company_id IN (${companyIds.map(() => '?').join(',')})`);
    vals.push(...companyIds);
  }
  const rows = db.prepare(
    `SELECT odoo_product_id AS pid, SUM(qty_base) AS total FROM stock_receipts WHERE ${where.join(' AND ')} GROUP BY odoo_product_id`,
  ).all(...vals) as { pid: number; total: number }[];
  const out: Record<number, number> = {};
  for (const r of rows) out[r.pid] = Number(r.total) || 0;
  return out;
}

// ===
// PRODUCT PICTURES (one primary image per product)
// ===

export function setProductImage(productId: number, image: string, mime: string | null, userId: number): void {
  const db = getDb();
  db.prepare(`INSERT INTO product_images (odoo_product_id, image, mime, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      image = excluded.image, mime = excluded.mime,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(productId, image, mime, userId, now());
}

export function getProductImage(productId: number): { image: string; mime: string | null } | null {
  const db = getDb();
  const r = db.prepare('SELECT image, mime FROM product_images WHERE odoo_product_id = ?').get(productId) as
    { image: string; mime: string | null } | undefined;
  return r ? { image: r.image, mime: r.mime ?? null } : null;
}

export function deleteProductImage(productId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM product_images WHERE odoo_product_id = ?').run(productId);
}

/** Product ids that have a picture — so a UI shows a thumbnail only where present. */
export function listProductImageIds(): number[] {
  const db = getDb();
  return (db.prepare('SELECT odoo_product_id FROM product_images').all() as { odoo_product_id: number }[])
    .map(r => r.odoo_product_id);
}

/**
 * Set (or clear) the word staff count a product in ('crate' | 'bunch' |
 * 'piece' | 'tray'…). Pass null/'' to clear. Leaves the size + photo flag
 * untouched (defaults on a brand-new row only).
 */
export function setProductPackLabel(
  productId: number,
  packLabel: string | null,
  userId: number,
) {
  const db = getDb();
  const label = packLabel && packLabel.trim() ? packLabel.trim().toLowerCase() : null;
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, pack_label, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      pack_label = excluded.pack_label,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, label, userId, now());
}

// ===
// COUNT PHOTOS (per-line photo proof)
// ===

export type PhotoSource = 'count_entries' | 'quick_counts';

/**
 * Replace the full set of photos for a given count line. Deletes any
 * existing photos then inserts the provided set. Pass an empty array
 * to clear photos for a line.
 */
export function setCountPhotos(source: PhotoSource, sourceId: number, photos: string[]) {
  const db = getDb();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM count_photos WHERE source_table = ? AND source_id = ?')
      .run(source, sourceId);
    const insert = db.prepare(
      'INSERT INTO count_photos (source_table, source_id, photo, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const p of photos) insert.run(source, sourceId, p, ts);
  });
  tx();
}

/**
 * Get all photos for a single count line.
 */
export function getCountPhotos(source: PhotoSource, sourceId: number): string[] {
  const db = getDb();
  return (db.prepare(
    'SELECT photo FROM count_photos WHERE source_table = ? AND source_id = ? ORDER BY id'
  ).all(source, sourceId) as { photo: string }[]).map(r => r.photo);
}

/**
 * Bulk fetch: returns { sourceId → string[] } for the given line IDs.
 */
export function getCountPhotosMap(source: PhotoSource, sourceIds: number[]): Record<number, string[]> {
  if (sourceIds.length === 0) return {};
  const db = getDb();
  const placeholders = sourceIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT source_id, photo FROM count_photos WHERE source_table = ? AND source_id IN (${placeholders}) ORDER BY id`
  ).all(source, ...sourceIds) as { source_id: number; photo: string }[];
  const map: Record<number, string[]> = {};
  for (const r of rows) {
    if (!map[r.source_id]) map[r.source_id] = [];
    map[r.source_id].push(r.photo);
  }
  return map;
}

export function deleteCountPhotos(source: PhotoSource, sourceId: number) {
  const db = getDb();
  db.prepare('DELETE FROM count_photos WHERE source_table = ? AND source_id = ?')
    .run(source, sourceId);
}

// ===
// COUNT LOCATIONS (the digital twin — portal-owned, company-scoped)
// ===

export function createCountLocation(data: {
  parent_id?: number | null;
  company_id: number;
  name: string;
  kind?: string;
  description?: string | null;
  photo?: string | null;
  odoo_location_id?: number | null;
  created_by: number;
}): number {
  const db = getDb();
  const ts = now();
  // Default sort_order = max sibling + 10 within the same company + parent.
  const sib = db.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM count_locations
     WHERE company_id = ? AND ${data.parent_id != null ? 'parent_id = ?' : 'parent_id IS NULL'}`
  ).get(...(data.parent_id != null ? [data.company_id, data.parent_id] : [data.company_id])) as { m: number };
  const r = db.prepare(`
    INSERT INTO count_locations (parent_id, company_id, name, kind, description, photo, sort_order, odoo_location_id, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    data.parent_id ?? null, data.company_id, data.name, data.kind || 'area',
    data.description ?? null, data.photo ?? null, sib.m + 10,
    data.odoo_location_id ?? null, data.created_by, ts, ts
  );
  return r.lastInsertRowid as number;
}

export function getCountLocation(id: number): CountLocation | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM count_locations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? { ...(r as unknown as CountLocation), active: !!r.active } : null;
}

/** Update a location. Scoped by company_id so a manager can never edit another company's location by guessing an id. */
export function updateCountLocation(id: number, companyId: number, data: Partial<{
  name: string; kind: string; description: string | null; photo: string | null;
  sort_order: number; odoo_location_id: number | null; parent_id: number | null; active: boolean;
}>): void {
  const db = getDb();
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  if (data.name !== undefined) put('name', data.name);
  if (data.kind !== undefined) put('kind', data.kind);
  if (data.description !== undefined) put('description', data.description);
  if (data.photo !== undefined) put('photo', data.photo);
  if (data.sort_order !== undefined) put('sort_order', data.sort_order);
  if (data.odoo_location_id !== undefined) put('odoo_location_id', data.odoo_location_id);
  if (data.parent_id !== undefined) put('parent_id', data.parent_id);
  if (data.active !== undefined) put('active', data.active ? 1 : 0);
  if (sets.length === 0) return;
  put('updated_at', now()); vals.push(id, companyId);
  db.prepare(`UPDATE count_locations SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}

/**
 * Delete a location and everything under it (children + all placements), scoped by company.
 * No FK reliance (SQLite FK enforcement is off by default), so cascade is done manually.
 * NOTE (Phase 2): once session history references locations, switch this to a soft delete
 * (active = 0, already filtered by listCountLocations) so a historical count is never orphaned.
 */
export function deleteCountLocation(id: number, companyId: number): void {
  const db = getDb();
  const ids: number[] = [];
  const seen = new Set<number>();
  const collect = (parent: number) => {
    if (seen.has(parent)) return; // guard against any accidental cycle
    seen.add(parent);
    ids.push(parent);
    const kids = db.prepare('SELECT id FROM count_locations WHERE parent_id = ? AND company_id = ?')
      .all(parent, companyId) as { id: number }[];
    kids.forEach((k) => collect(k.id));
  };
  // Only proceed if the root belongs to this company.
  const root = db.prepare('SELECT id FROM count_locations WHERE id = ? AND company_id = ?').get(id, companyId);
  if (!root) return;
  collect(id);
  const tx = db.transaction(() => {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM product_locations WHERE count_location_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM count_locations WHERE id IN (${ph}) AND company_id = ?`).run(...ids, companyId);
  });
  tx();
}

export function listCountLocations(companyId: number): CountLocation[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM count_locations WHERE company_id = ? AND active = 1 ORDER BY sort_order, id'
  ).all(companyId) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as CountLocation), active: !!r.active }));
}

export function getCountLocationsByIds(ids: number[]): CountLocation[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM count_locations WHERE id IN (${ph}) AND active = 1`
  ).all(...ids) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as CountLocation), active: !!r.active }));
}

/** Replace the full placement set for a location (products + their shelf order). */
export function setProductPlacements(countLocationId: number, items: { odoo_product_id: number; shelf_sort: number }[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM product_locations WHERE count_location_id = ?').run(countLocationId);
    const ins = db.prepare('INSERT INTO product_locations (odoo_product_id, count_location_id, shelf_sort) VALUES (?, ?, ?)');
    items.forEach((it) => ins.run(it.odoo_product_id, countLocationId, it.shelf_sort));
  });
  tx();
}

export function getPlacements(countLocationId: number): ProductPlacement[] {
  const db = getDb();
  return db.prepare(
    'SELECT odoo_product_id, count_location_id, shelf_sort FROM product_locations WHERE count_location_id = ? ORDER BY shelf_sort, odoo_product_id'
  ).all(countLocationId) as ProductPlacement[];
}

export function getLocationsForProduct(productId: number): number[] {
  const db = getDb();
  return (db.prepare('SELECT count_location_id FROM product_locations WHERE odoo_product_id = ?').all(productId) as { count_location_id: number }[])
    .map((r) => r.count_location_id);
}

/** All placements for a set of products (used to build a session's guided route). */
export function getPlacementsForProducts(productIds: number[]): ProductPlacement[] {
  if (productIds.length === 0) return [];
  const db = getDb();
  const ph = productIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT odoo_product_id, count_location_id, shelf_sort FROM product_locations WHERE odoo_product_id IN (${ph})`
  ).all(...productIds) as ProductPlacement[];
}

// ===
// SESSION LOCATION STATUS (guided route — per-stop counted/skipped state)
// ===

export function setSessionLocationStatus(
  sessionId: number, countLocationId: number, status: string, skipReason: string | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO session_location_status (session_id, count_location_id, status, skip_reason, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, count_location_id) DO UPDATE SET
      status = excluded.status, skip_reason = excluded.skip_reason, updated_at = excluded.updated_at
  `).run(sessionId, countLocationId, status, skipReason ?? null, now());
}

export function getSessionLocationStatuses(sessionId: number): { count_location_id: number; status: string; skip_reason: string | null }[] {
  const db = getDb();
  return db.prepare(
    'SELECT count_location_id, status, skip_reason FROM session_location_status WHERE session_id = ?'
  ).all(sessionId) as { count_location_id: number; status: string; skip_reason: string | null }[];
}

// ===
// LOCATION KINDS (per-company manageable "type" list for count locations)
// ===

export interface LocationKindRow {
  id: number;
  company_id: number;
  kind: string;   // stored value on count_locations.kind (lowercase)
  label: string;  // what managers see in the Type dropdown
  sort_order: number;
}

const DEFAULT_LOCATION_KINDS: { kind: string; label: string }[] = [
  { kind: 'area', label: 'Area' },
  { kind: 'fridge', label: 'Fridge' },
  { kind: 'freezer', label: 'Freezer' },
  { kind: 'dry', label: 'Dry store' },
  { kind: 'zone', label: 'Zone' },
  { kind: 'bar', label: 'Bar' },
];

/**
 * List a company's location kinds, seeding the six defaults the first time a
 * company touches the feature (so existing kinds keep their labels and every
 * company starts from the familiar set).
 */
export function listLocationKinds(companyId: number): LocationKindRow[] {
  const db = getDb();
  const existing = db.prepare(
    'SELECT COUNT(*) AS n FROM location_kinds WHERE company_id = ?'
  ).get(companyId) as { n: number };
  if (existing.n === 0) {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO location_kinds (company_id, kind, label, sort_order, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    DEFAULT_LOCATION_KINDS.forEach((k, i) => ins.run(companyId, k.kind, k.label, (i + 1) * 10, now()));
  }
  return db.prepare(
    'SELECT id, company_id, kind, label, sort_order FROM location_kinds WHERE company_id = ? ORDER BY sort_order, id'
  ).all(companyId) as LocationKindRow[];
}

/**
 * Add a kind. The stored `kind` value is the lowercased label (kept simple —
 * count_locations.kind is free text). Returns null when a same-named kind
 * already exists for the company (case-insensitive).
 */
export function addLocationKind(companyId: number, label: string, userId: number): LocationKindRow | null {
  const db = getDb();
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  const kind = clean.toLowerCase();
  // Duplicate if either the stored kind or the visible label matches — the
  // defaults have kind ≠ label ("dry" / "Dry store"), so check both.
  const dupe = db.prepare(
    'SELECT id FROM location_kinds WHERE company_id = ? AND (lower(kind) = ? OR lower(label) = ?)'
  ).get(companyId, kind, kind);
  if (dupe) return null;
  const maxSort = (db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM location_kinds WHERE company_id = ?'
  ).get(companyId) as { m: number }).m;
  try {
    const r = db.prepare(
      'INSERT INTO location_kinds (company_id, kind, label, sort_order, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(companyId, kind, clean, maxSort + 10, userId, now());
    return {
      id: r.lastInsertRowid as number, company_id: companyId, kind, label: clean, sort_order: maxSort + 10,
    };
  } catch {
    // Unique-constraint race (two adds of the same name) → treat as duplicate
    return null;
  }
}

/**
 * Delete a kind — refused while any of the company's active locations still
 * uses it (returns the usage count so the UI can explain).
 */
export function deleteLocationKind(id: number, companyId: number): { ok: boolean; in_use: number } {
  const db = getDb();
  const row = db.prepare(
    'SELECT kind FROM location_kinds WHERE id = ? AND company_id = ?'
  ).get(id, companyId) as { kind: string } | undefined;
  if (!row) return { ok: false, in_use: 0 };
  // Compare in JS: SQLite lower() only folds ASCII, and German type names
  // (Kühlraum…) are realistic here. JS toLowerCase() is Unicode-correct.
  const target = row.kind.toLowerCase();
  const used = (db.prepare(
    'SELECT kind FROM count_locations WHERE company_id = ? AND active = 1'
  ).all(companyId) as { kind: string }[])
    .filter((l) => (l.kind || '').toLowerCase() === target).length;
  if (used > 0) return { ok: false, in_use: used };
  db.prepare('DELETE FROM location_kinds WHERE id = ? AND company_id = ?').run(id, companyId);
  return { ok: true, in_use: 0 };
}

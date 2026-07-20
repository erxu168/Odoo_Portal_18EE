/**
 * Shift Handover — persistence layer.
 *
 * Portal-only: every row lives in the shared portal SQLite DB (data/portal.db)
 * via getDb(). No Odoo stock / MO / quant / lot dependency. Follows the
 * inventory-db.ts conventions: an exported initHandoverTables() called at the
 * top of each API route (idempotent CREATE ... IF NOT EXISTS + guarded ALTER
 * migrations), snake_case tables prefixed `handover_`, integer booleans, ISO
 * timestamps, INTEGER PRIMARY KEY ids, per-row company_id scoping.
 *
 * Submitted-handover snapshots and the canonical event log are made immutable by
 * BEFORE UPDATE/DELETE triggers — a submitted handover cannot be silently edited.
 */
import { getDb } from '@/lib/db';
import { initInventoryTables } from '@/lib/inventory-db';
import type {
  HandoverProduct,
  HandoverContainerType,
  HandoverBatch,
  HandoverContainer,
  HandoverPhoto,
  HandoverAction,
  HandoverRecord,
  HandoverDiscrepancy,
  HandoverEvent,
} from './types';

export function nowISO(): string {
  return new Date().toISOString();
}

let _inited = false;

export function initHandoverTables(): void {
  const db = getDb();
  if (_inited) return;
  // Give concurrent kitchen writers room instead of failing on a locked DB.
  try { db.pragma('busy_timeout = 5000'); } catch { /* best effort */ }
  // We REUSE the inventory count_locations tree for storage locations, so make
  // sure those tables exist even if no inventory route has run yet.
  try { initInventoryTables(); } catch (e) { console.error('[shift-handover] inventory table init failed:', e); }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS handover_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'finished',
        unit TEXT,
        odoo_product_id INTEGER,
        photo_policy TEXT NOT NULL DEFAULT 'optional',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_container_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        capacity_label TEXT,
        reference_photo TEXT,
        internal_code TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        operational_date TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        shift_label TEXT,
        batch_code TEXT,
        produced_by_user_id INTEGER,
        produced_by_name TEXT,
        produced_at TEXT NOT NULL,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        batch_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        container_code TEXT NOT NULL,
        container_type_id INTEGER,
        fill_level INTEGER CHECK (fill_level IN (0, 25, 50, 75, 100)),
        quantity_method TEXT,
        exact_quantity REAL,
        unit TEXT,
        preparation_state TEXT,
        availability_state TEXT,
        storage_location_id INTEGER,
        use_first INTEGER NOT NULL DEFAULT 0,
        next_action TEXT,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        created_by_user_id INTEGER,
        created_by_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        event TEXT,
        photo TEXT NOT NULL,
        caption TEXT,
        uploaded_by_user_id INTEGER,
        uploaded_by_name TEXT,
        uploaded_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        replaced_photo_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS handover_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        operational_date TEXT NOT NULL,
        batch_id INTEGER,
        container_id INTEGER,
        handover_id INTEGER,
        instruction TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        assigned_role TEXT,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        completed_by_user_id INTEGER,
        completed_by_name TEXT,
        completed_at TEXT,
        completion_note TEXT,
        completion_photo_id INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        created_by_user_id INTEGER,
        created_by_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_handovers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        operational_date TEXT NOT NULL,
        outgoing_shift_label TEXT,
        incoming_shift_label TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        summary_note TEXT,
        submitted_by_user_id INTEGER,
        submitted_by_name TEXT,
        submitted_at TEXT,
        snapshot_hash TEXT,
        acknowledged_by_user_id INTEGER,
        acknowledged_by_name TEXT,
        acknowledged_at TEXT,
        ack_outcome TEXT,
        superseded_by_id INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        created_by_user_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_snapshot_containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handover_id INTEGER NOT NULL,
        company_id INTEGER NOT NULL,
        container_id INTEGER,
        batch_id INTEGER,
        product_name TEXT,
        product_kind TEXT,
        container_code TEXT,
        container_type_name TEXT,
        fill_level INTEGER,
        preparation_state TEXT,
        availability_state TEXT,
        storage_location_id INTEGER,
        storage_location_name TEXT,
        use_first INTEGER,
        next_action TEXT,
        recorded_by_name TEXT,
        recorded_at TEXT,
        photos_json TEXT,
        section TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_snapshot_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handover_id INTEGER NOT NULL,
        company_id INTEGER NOT NULL,
        action_id INTEGER,
        instruction TEXT,
        priority TEXT,
        status TEXT,
        due_at TEXT,
        container_code TEXT,
        product_name TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_discrepancies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        handover_id INTEGER NOT NULL,
        snapshot_container_id INTEGER,
        discrepancy_type TEXT NOT NULL,
        expected_value TEXT,
        reported_value TEXT,
        note TEXT,
        photo_id INTEGER,
        reported_by_user_id INTEGER,
        reported_by_name TEXT,
        reported_at TEXT NOT NULL,
        resolved_by_user_id INTEGER,
        resolved_by_name TEXT,
        resolved_at TEXT,
        resolution_note TEXT,
        status TEXT NOT NULL DEFAULT 'open'
      );

      CREATE TABLE IF NOT EXISTS handover_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        actor_name TEXT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        action TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        reason TEXT,
        operational_date TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_idempotency (
        key TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        scope TEXT NOT NULL,
        result_id INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (key, company_id, scope)
      );

      CREATE INDEX IF NOT EXISTS idx_ho_batches_co_date ON handover_batches(company_id, operational_date);
      CREATE INDEX IF NOT EXISTS idx_ho_containers_batch ON handover_containers(batch_id);
      CREATE INDEX IF NOT EXISTS idx_ho_containers_co_status ON handover_containers(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_ho_containers_loc ON handover_containers(storage_location_id);
      CREATE INDEX IF NOT EXISTS idx_ho_photos_entity ON handover_photos(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_ho_actions_co_status ON handover_actions(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_ho_handovers_co_date ON handover_handovers(company_id, operational_date);
      CREATE INDEX IF NOT EXISTS idx_ho_snapcont_handover ON handover_snapshot_containers(handover_id);
      CREATE INDEX IF NOT EXISTS idx_ho_snapact_handover ON handover_snapshot_actions(handover_id);
      CREATE INDEX IF NOT EXISTS idx_ho_discrep_handover ON handover_discrepancies(handover_id);
      CREATE INDEX IF NOT EXISTS idx_ho_events_co_date ON handover_events(company_id, operational_date);

      -- At most one in-progress handover per (company, date, outgoing shift).
      CREATE UNIQUE INDEX IF NOT EXISTS uidx_ho_active_handover
        ON handover_handovers(company_id, operational_date, outgoing_shift_label)
        WHERE status IN ('draft', 'submitted');

      -- Immutability: a submitted snapshot and the canonical event log can never
      -- be updated or deleted, so a locked handover cannot be silently rewritten.
      CREATE TRIGGER IF NOT EXISTS trg_ho_snapcont_noupdate
        BEFORE UPDATE ON handover_snapshot_containers
        BEGIN SELECT RAISE(ABORT, 'handover snapshot is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS trg_ho_snapcont_nodelete
        BEFORE DELETE ON handover_snapshot_containers
        BEGIN SELECT RAISE(ABORT, 'handover snapshot is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS trg_ho_snapact_noupdate
        BEFORE UPDATE ON handover_snapshot_actions
        BEGIN SELECT RAISE(ABORT, 'handover snapshot is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS trg_ho_snapact_nodelete
        BEFORE DELETE ON handover_snapshot_actions
        BEGIN SELECT RAISE(ABORT, 'handover snapshot is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS trg_ho_events_noupdate
        BEFORE UPDATE ON handover_events
        BEGIN SELECT RAISE(ABORT, 'handover audit log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS trg_ho_events_nodelete
        BEFORE DELETE ON handover_events
        BEGIN SELECT RAISE(ABORT, 'handover audit log is append-only'); END;
    `);
  } catch (e) {
    console.error('[shift-handover] table/index/trigger init error (continuing to migrate):', e);
  }

  migrateHandoverSchema();
  _inited = true;
}

/**
 * Additive, idempotent migrations for future columns. Uses the inventory-db.ts
 * idiom: read PRAGMA table_info, ALTER only when missing, tolerate a concurrent
 * duplicate-column race. No user_version scheme (matches the repo convention).
 */
function migrateHandoverSchema(): void {
  const db = getDb();
  const addColumn = (table: string, col: string, ddl: string) => {
    try {
      const cols = (db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]).map((c) => c.name);
      if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch (e) {
      if (!(e instanceof Error && /duplicate column/i.test(e.message))) {
        console.error(`[shift-handover] migrate ${table}.${col} failed:`, e);
      }
    }
  };
  // (No migrations yet — new columns go here, e.g.)
  // addColumn('handover_products', 'kg_per_full_container', 'kg_per_full_container REAL');
  void addColumn;
}

// ── small helpers ────────────────────────────────────────────────────────────
const b = (v: unknown) => (v ? 1 : 0);
function inClause(ids: number[]): string {
  return ids.map(() => '?').join(',');
}

// ── Products ─────────────────────────────────────────────────────────────────
export function listHandoverProducts(companyId: number, opts?: { includeInactive?: boolean }): HandoverProduct[] {
  const db = getDb();
  const where = opts?.includeInactive ? '' : 'AND active = 1';
  return db.prepare(
    `SELECT * FROM handover_products WHERE company_id = ? ${where} ORDER BY sort_order, name`,
  ).all(companyId) as HandoverProduct[];
}
export function getHandoverProduct(id: number): HandoverProduct | null {
  return (getDb().prepare('SELECT * FROM handover_products WHERE id = ?').get(id) as HandoverProduct) ?? null;
}
export function createHandoverProduct(d: {
  company_id: number; name: string; kind?: string; unit?: string | null;
  odoo_product_id?: number | null; photo_policy?: string; sort_order?: number;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_products (company_id, name, kind, unit, odoo_product_id, photo_policy, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(d.company_id, d.name, d.kind || 'finished', d.unit ?? null, d.odoo_product_id ?? null,
    d.photo_policy || 'optional', d.sort_order ?? 0, ts, ts);
  return r.lastInsertRowid as number;
}
export function updateHandoverProduct(id: number, companyId: number, d: Partial<{
  name: string; kind: string; unit: string | null; photo_policy: string; active: boolean; sort_order: number;
}>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (c: string, v: unknown) => { sets.push(`${c} = ?`); vals.push(v); };
  if (d.name !== undefined) put('name', d.name);
  if (d.kind !== undefined) put('kind', d.kind);
  if (d.unit !== undefined) put('unit', d.unit);
  if (d.photo_policy !== undefined) put('photo_policy', d.photo_policy);
  if (d.active !== undefined) put('active', b(d.active));
  if (d.sort_order !== undefined) put('sort_order', d.sort_order);
  if (!sets.length) return;
  put('updated_at', nowISO()); vals.push(id, companyId);
  getDb().prepare(`UPDATE handover_products SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}

// ── Container types ──────────────────────────────────────────────────────────
export function listContainerTypes(companyId: number, opts?: { includeInactive?: boolean }): HandoverContainerType[] {
  const where = opts?.includeInactive ? '' : 'AND active = 1';
  return getDb().prepare(
    `SELECT * FROM handover_container_types WHERE company_id = ? ${where} ORDER BY sort_order, name`,
  ).all(companyId) as HandoverContainerType[];
}
export function getContainerType(id: number): HandoverContainerType | null {
  return (getDb().prepare('SELECT * FROM handover_container_types WHERE id = ?').get(id) as HandoverContainerType) ?? null;
}
export function createContainerType(d: {
  company_id: number; name: string; category?: string | null; capacity_label?: string | null;
  reference_photo?: string | null; internal_code?: string | null; sort_order?: number;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_container_types (company_id, name, category, capacity_label, reference_photo, internal_code, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(d.company_id, d.name, d.category ?? null, d.capacity_label ?? null, d.reference_photo ?? null,
    d.internal_code ?? null, d.sort_order ?? 0, ts, ts);
  return r.lastInsertRowid as number;
}
export function updateContainerType(id: number, companyId: number, d: Partial<{
  name: string; category: string | null; capacity_label: string | null; reference_photo: string | null;
  internal_code: string | null; active: boolean; sort_order: number;
}>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (c: string, v: unknown) => { sets.push(`${c} = ?`); vals.push(v); };
  for (const k of ['name', 'category', 'capacity_label', 'reference_photo', 'internal_code', 'sort_order'] as const) {
    if (d[k] !== undefined) put(k, d[k]);
  }
  if (d.active !== undefined) put('active', b(d.active));
  if (!sets.length) return;
  put('updated_at', nowISO()); vals.push(id, companyId);
  getDb().prepare(`UPDATE handover_container_types SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}

// ── Batches ──────────────────────────────────────────────────────────────────
export function createBatch(d: {
  company_id: number; operational_date: string; product_id: number; product_name: string;
  shift_label?: string | null; batch_code?: string | null; produced_by_user_id?: number | null;
  produced_by_name?: string | null; produced_at?: string; note?: string | null;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_batches (company_id, operational_date, product_id, product_name, shift_label, batch_code, produced_by_user_id, produced_by_name, produced_at, note, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?)`,
  ).run(d.company_id, d.operational_date, d.product_id, d.product_name, d.shift_label ?? null,
    d.batch_code ?? null, d.produced_by_user_id ?? null, d.produced_by_name ?? null,
    d.produced_at || ts, d.note ?? null, ts, ts);
  return r.lastInsertRowid as number;
}
export function getBatch(id: number): HandoverBatch | null {
  return (getDb().prepare('SELECT * FROM handover_batches WHERE id = ?').get(id) as HandoverBatch) ?? null;
}
export function listBatches(companyIds: number[] | undefined, filters?: {
  operational_date?: string; status?: string;
}): HandoverBatch[] {
  const where: string[] = []; const vals: unknown[] = [];
  if (companyIds !== undefined) {
    if (companyIds.length === 0) return [];
    where.push(`company_id IN (${inClause(companyIds)})`); vals.push(...companyIds);
  }
  if (filters?.operational_date) { where.push('operational_date = ?'); vals.push(filters.operational_date); }
  if (filters?.status) { where.push('status = ?'); vals.push(filters.status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM handover_batches ${clause} ORDER BY produced_at DESC, id DESC`).all(...vals) as HandoverBatch[];
}
export function updateBatch(id: number, companyId: number, d: Partial<{ note: string | null; status: string; shift_label: string | null }>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (c: string, v: unknown) => { sets.push(`${c} = ?`); vals.push(v); };
  if (d.note !== undefined) put('note', d.note);
  if (d.status !== undefined) put('status', d.status);
  if (d.shift_label !== undefined) put('shift_label', d.shift_label);
  if (!sets.length) return;
  sets.push('version = version + 1'); put('updated_at', nowISO());
  vals.push(id, companyId);
  getDb().prepare(`UPDATE handover_batches SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}

// ── Containers ───────────────────────────────────────────────────────────────
export function createContainer(d: {
  company_id: number; batch_id: number; product_id: number; container_code: string;
  container_type_id?: number | null; fill_level?: number | null; quantity_method?: string | null;
  exact_quantity?: number | null; unit?: string | null; preparation_state?: string | null;
  availability_state?: string | null; storage_location_id?: number | null; use_first?: boolean;
  next_action?: string | null; note?: string | null; status?: string;
  created_by_user_id?: number | null; created_by_name?: string | null;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_containers (company_id, batch_id, product_id, container_code, container_type_id, fill_level, quantity_method, exact_quantity, unit, preparation_state, availability_state, storage_location_id, use_first, next_action, note, status, version, created_by_user_id, created_by_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(d.company_id, d.batch_id, d.product_id, d.container_code, d.container_type_id ?? null,
    d.fill_level ?? null, d.quantity_method ?? null, d.exact_quantity ?? null, d.unit ?? null,
    d.preparation_state ?? null, d.availability_state ?? null, d.storage_location_id ?? null,
    b(d.use_first), d.next_action ?? null, d.note ?? null, d.status || 'active',
    d.created_by_user_id ?? null, d.created_by_name ?? null, ts, ts);
  return r.lastInsertRowid as number;
}
export function getContainer(id: number): HandoverContainer | null {
  return (getDb().prepare('SELECT * FROM handover_containers WHERE id = ?').get(id) as HandoverContainer) ?? null;
}
export function listContainersByBatch(batchId: number): HandoverContainer[] {
  return getDb().prepare('SELECT * FROM handover_containers WHERE batch_id = ? ORDER BY container_code, id').all(batchId) as HandoverContainer[];
}
export function listContainers(companyIds: number[] | undefined, filters?: {
  operational_date?: string; status?: string; storage_location_id?: number; use_first?: boolean;
  availability_state?: string; preparation_state?: string; product_id?: number;
}): HandoverContainer[] {
  // Join batches for operational_date filtering.
  const where: string[] = []; const vals: unknown[] = [];
  if (companyIds !== undefined) {
    if (companyIds.length === 0) return [];
    where.push(`c.company_id IN (${inClause(companyIds)})`); vals.push(...companyIds);
  }
  if (filters?.status) { where.push('c.status = ?'); vals.push(filters.status); }
  if (filters?.storage_location_id) { where.push('c.storage_location_id = ?'); vals.push(filters.storage_location_id); }
  if (filters?.use_first !== undefined) { where.push('c.use_first = ?'); vals.push(b(filters.use_first)); }
  if (filters?.availability_state) { where.push('c.availability_state = ?'); vals.push(filters.availability_state); }
  if (filters?.preparation_state) { where.push('c.preparation_state = ?'); vals.push(filters.preparation_state); }
  if (filters?.product_id) { where.push('c.product_id = ?'); vals.push(filters.product_id); }
  if (filters?.operational_date) { where.push('b.operational_date = ?'); vals.push(filters.operational_date); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb().prepare(
    `SELECT c.* FROM handover_containers c JOIN handover_batches b ON b.id = c.batch_id ${clause} ORDER BY c.updated_at DESC, c.id DESC`,
  ).all(...vals) as HandoverContainer[];
}
export function updateContainer(id: number, companyId: number, d: Partial<{
  container_code: string; container_type_id: number | null; fill_level: number | null;
  quantity_method: string | null; exact_quantity: number | null; unit: string | null;
  preparation_state: string | null; availability_state: string | null; storage_location_id: number | null;
  use_first: boolean; next_action: string | null; note: string | null; status: string;
}>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (c: string, v: unknown) => { sets.push(`${c} = ?`); vals.push(v); };
  for (const k of ['container_code', 'container_type_id', 'fill_level', 'quantity_method', 'exact_quantity', 'unit', 'preparation_state', 'availability_state', 'storage_location_id', 'next_action', 'note', 'status'] as const) {
    if (d[k] !== undefined) put(k, d[k] as unknown);
  }
  if (d.use_first !== undefined) put('use_first', b(d.use_first));
  if (!sets.length) return;
  sets.push('version = version + 1'); put('updated_at', nowISO());
  vals.push(id, companyId);
  getDb().prepare(`UPDATE handover_containers SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}

// ── Photos ───────────────────────────────────────────────────────────────────
export function addPhoto(d: {
  company_id: number; entity_type: string; entity_id: number; event?: string | null;
  photo: string; caption?: string | null; uploaded_by_user_id?: number | null;
  uploaded_by_name?: string | null; replaced_photo_id?: number | null;
}): number {
  const r = getDb().prepare(
    `INSERT INTO handover_photos (company_id, entity_type, entity_id, event, photo, caption, uploaded_by_user_id, uploaded_by_name, uploaded_at, active, replaced_photo_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(d.company_id, d.entity_type, d.entity_id, d.event ?? null, d.photo, d.caption ?? null,
    d.uploaded_by_user_id ?? null, d.uploaded_by_name ?? null, nowISO(), d.replaced_photo_id ?? null);
  return r.lastInsertRowid as number;
}
export function listPhotos(entityType: string, entityId: number, opts?: { includeInactive?: boolean }): HandoverPhoto[] {
  const where = opts?.includeInactive ? '' : 'AND active = 1';
  return getDb().prepare(
    `SELECT * FROM handover_photos WHERE entity_type = ? AND entity_id = ? ${where} ORDER BY uploaded_at DESC, id DESC`,
  ).all(entityType, entityId) as HandoverPhoto[];
}
export function countActivePhotos(entityType: string, entityId: number): number {
  const r = getDb().prepare(
    'SELECT COUNT(*) AS n FROM handover_photos WHERE entity_type = ? AND entity_id = ? AND active = 1',
  ).get(entityType, entityId) as { n: number };
  return r.n;
}
/** Soft-delete: never destroy history. */
export function deactivatePhoto(id: number, companyId: number): void {
  getDb().prepare('UPDATE handover_photos SET active = 0 WHERE id = ? AND company_id = ?').run(id, companyId);
}
export function getPhoto(id: number): HandoverPhoto | null {
  return (getDb().prepare('SELECT * FROM handover_photos WHERE id = ?').get(id) as HandoverPhoto) ?? null;
}

// ── Actions ──────────────────────────────────────────────────────────────────
export function createAction(d: {
  company_id: number; operational_date: string; batch_id?: number | null; container_id?: number | null;
  handover_id?: number | null; instruction: string; priority?: string; assigned_role?: string | null;
  due_at?: string | null; created_by_user_id?: number | null; created_by_name?: string | null;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_actions (company_id, operational_date, batch_id, container_id, handover_id, instruction, priority, assigned_role, due_at, status, version, created_by_user_id, created_by_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, ?, ?)`,
  ).run(d.company_id, d.operational_date, d.batch_id ?? null, d.container_id ?? null, d.handover_id ?? null,
    d.instruction, d.priority || 'normal', d.assigned_role ?? null, d.due_at ?? null,
    d.created_by_user_id ?? null, d.created_by_name ?? null, ts, ts);
  return r.lastInsertRowid as number;
}
export function getAction(id: number): HandoverAction | null {
  return (getDb().prepare('SELECT * FROM handover_actions WHERE id = ?').get(id) as HandoverAction) ?? null;
}
export function listActions(companyIds: number[] | undefined, filters?: {
  operational_date?: string; status?: string; statuses?: string[]; container_id?: number; batch_id?: number;
}): HandoverAction[] {
  const where: string[] = []; const vals: unknown[] = [];
  if (companyIds !== undefined) {
    if (companyIds.length === 0) return [];
    where.push(`company_id IN (${inClause(companyIds)})`); vals.push(...companyIds);
  }
  if (filters?.operational_date) { where.push('operational_date = ?'); vals.push(filters.operational_date); }
  if (filters?.status) { where.push('status = ?'); vals.push(filters.status); }
  if (filters?.statuses && filters.statuses.length) { where.push(`status IN (${inClause(filters.statuses.map(() => 0))})`); vals.push(...filters.statuses); }
  if (filters?.container_id) { where.push('container_id = ?'); vals.push(filters.container_id); }
  if (filters?.batch_id) { where.push('batch_id = ?'); vals.push(filters.batch_id); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Order: food-safety-critical first, then urgent/important, then by due time.
  return getDb().prepare(
    `SELECT * FROM handover_actions ${clause}
     ORDER BY CASE priority WHEN 'food_safety_critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'important' THEN 2 ELSE 3 END,
              COALESCE(due_at, '9999'), id`,
  ).all(...vals) as HandoverAction[];
}
export function updateAction(id: number, companyId: number, d: Partial<{
  instruction: string; priority: string; assigned_role: string | null; due_at: string | null;
  status: string; completed_by_user_id: number | null; completed_by_name: string | null;
  completed_at: string | null; completion_note: string | null; completion_photo_id: number | null;
}>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (c: string, v: unknown) => { sets.push(`${c} = ?`); vals.push(v); };
  for (const k of ['instruction', 'priority', 'assigned_role', 'due_at', 'status', 'completed_by_user_id', 'completed_by_name', 'completed_at', 'completion_note', 'completion_photo_id'] as const) {
    if (d[k] !== undefined) put(k, d[k] as unknown);
  }
  if (!sets.length) return;
  sets.push('version = version + 1'); put('updated_at', nowISO());
  vals.push(id, companyId);
  getDb().prepare(`UPDATE handover_actions SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}

// ── Handovers ────────────────────────────────────────────────────────────────
export function createHandover(d: {
  company_id: number; operational_date: string; outgoing_shift_label?: string | null;
  incoming_shift_label?: string | null; summary_note?: string | null; created_by_user_id?: number | null;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_handovers (company_id, operational_date, outgoing_shift_label, incoming_shift_label, status, summary_note, version, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, 1, ?, ?, ?)`,
  ).run(d.company_id, d.operational_date, d.outgoing_shift_label ?? null, d.incoming_shift_label ?? null,
    d.summary_note ?? null, d.created_by_user_id ?? null, ts, ts);
  return r.lastInsertRowid as number;
}
export function getHandover(id: number): HandoverRecord | null {
  return (getDb().prepare('SELECT * FROM handover_handovers WHERE id = ?').get(id) as HandoverRecord) ?? null;
}
export function findActiveHandover(companyId: number, operationalDate: string, outgoingLabel: string | null): HandoverRecord | null {
  const db = getDb();
  const row = outgoingLabel == null
    ? db.prepare(`SELECT * FROM handover_handovers WHERE company_id = ? AND operational_date = ? AND outgoing_shift_label IS NULL AND status IN ('draft','submitted') ORDER BY id DESC LIMIT 1`).get(companyId, operationalDate)
    : db.prepare(`SELECT * FROM handover_handovers WHERE company_id = ? AND operational_date = ? AND outgoing_shift_label = ? AND status IN ('draft','submitted') ORDER BY id DESC LIMIT 1`).get(companyId, operationalDate, outgoingLabel);
  return (row as HandoverRecord) ?? null;
}
export function listHandovers(companyIds: number[] | undefined, filters?: { status?: string; from?: string; to?: string; limit?: number }): HandoverRecord[] {
  const where: string[] = []; const vals: unknown[] = [];
  if (companyIds !== undefined) {
    if (companyIds.length === 0) return [];
    where.push(`company_id IN (${inClause(companyIds)})`); vals.push(...companyIds);
  }
  if (filters?.status) { where.push('status = ?'); vals.push(filters.status); }
  if (filters?.from) { where.push('operational_date >= ?'); vals.push(filters.from); }
  if (filters?.to) { where.push('operational_date <= ?'); vals.push(filters.to); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 500);
  return getDb().prepare(`SELECT * FROM handover_handovers ${clause} ORDER BY operational_date DESC, id DESC LIMIT ?`).all(...vals, limit) as HandoverRecord[];
}
/** Raw handover-row update (status transitions, ack fields). Snapshot rows are separately immutable. */
export function updateHandoverRow(id: number, companyId: number, d: Record<string, unknown>, expectedVersion?: number): boolean {
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [c, v] of Object.entries(d)) { sets.push(`${c} = ?`); vals.push(v); }
  if (!sets.length) return false;
  sets.push('version = version + 1'); sets.push('updated_at = ?'); vals.push(nowISO());
  vals.push(id, companyId);
  let sql = `UPDATE handover_handovers SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`;
  if (expectedVersion !== undefined) { sql += ' AND version = ?'; vals.push(expectedVersion); }
  const r = getDb().prepare(sql).run(...vals);
  return r.changes > 0;
}

// ── Snapshots (write-only via commands; reads here) ─────────────────────────────
export function insertSnapshotContainer(row: Record<string, unknown>): number {
  const cols = Object.keys(row);
  const r = getDb().prepare(
    `INSERT INTO handover_snapshot_containers (${cols.join(', ')}, created_at) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
  ).run(...cols.map((c) => row[c]), nowISO());
  return r.lastInsertRowid as number;
}
export function insertSnapshotAction(row: Record<string, unknown>): number {
  const cols = Object.keys(row);
  const r = getDb().prepare(
    `INSERT INTO handover_snapshot_actions (${cols.join(', ')}, created_at) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
  ).run(...cols.map((c) => row[c]), nowISO());
  return r.lastInsertRowid as number;
}
export function listSnapshotContainers(handoverId: number): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM handover_snapshot_containers WHERE handover_id = ? ORDER BY id').all(handoverId) as Record<string, unknown>[];
}
/** True if a snapshot-container id really belongs to this handover + company. */
export function snapshotContainerBelongs(id: number, handoverId: number, companyId: number): boolean {
  return !!getDb().prepare(
    'SELECT 1 FROM handover_snapshot_containers WHERE id = ? AND handover_id = ? AND company_id = ?',
  ).get(id, handoverId, companyId);
}
export function listSnapshotActions(handoverId: number): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM handover_snapshot_actions WHERE handover_id = ? ORDER BY id').all(handoverId) as Record<string, unknown>[];
}

// ── Discrepancies ────────────────────────────────────────────────────────────
export function createDiscrepancy(d: {
  company_id: number; handover_id: number; snapshot_container_id?: number | null; discrepancy_type: string;
  expected_value?: string | null; reported_value?: string | null; note?: string | null; photo_id?: number | null;
  reported_by_user_id?: number | null; reported_by_name?: string | null;
}): number {
  const r = getDb().prepare(
    `INSERT INTO handover_discrepancies (company_id, handover_id, snapshot_container_id, discrepancy_type, expected_value, reported_value, note, photo_id, reported_by_user_id, reported_by_name, reported_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
  ).run(d.company_id, d.handover_id, d.snapshot_container_id ?? null, d.discrepancy_type, d.expected_value ?? null,
    d.reported_value ?? null, d.note ?? null, d.photo_id ?? null, d.reported_by_user_id ?? null, d.reported_by_name ?? null, nowISO());
  return r.lastInsertRowid as number;
}
export function listDiscrepancies(handoverId: number): HandoverDiscrepancy[] {
  return getDb().prepare('SELECT * FROM handover_discrepancies WHERE handover_id = ? ORDER BY id').all(handoverId) as HandoverDiscrepancy[];
}
export function getDiscrepancy(id: number): HandoverDiscrepancy | null {
  return (getDb().prepare('SELECT * FROM handover_discrepancies WHERE id = ?').get(id) as HandoverDiscrepancy) ?? null;
}
export function resolveDiscrepancy(id: number, companyId: number, d: { resolved_by_user_id: number; resolved_by_name: string; resolution_note?: string | null }): void {
  getDb().prepare(
    `UPDATE handover_discrepancies SET status = 'resolved', resolved_by_user_id = ?, resolved_by_name = ?, resolved_at = ?, resolution_note = ? WHERE id = ? AND company_id = ?`,
  ).run(d.resolved_by_user_id, d.resolved_by_name, nowISO(), d.resolution_note ?? null, id, companyId);
}

// ── Events (canonical audit) ─────────────────────────────────────────────────
export function logHandoverEvent(d: {
  company_id: number; actor_user_id?: number | null; actor_name?: string | null;
  entity_type: string; entity_id?: number | null; action: string;
  before?: unknown; after?: unknown; reason?: string | null; operational_date?: string | null;
}): void {
  getDb().prepare(
    `INSERT INTO handover_events (company_id, actor_user_id, actor_name, entity_type, entity_id, action, before_json, after_json, reason, operational_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(d.company_id, d.actor_user_id ?? null, d.actor_name ?? null, d.entity_type, d.entity_id ?? null, d.action,
    d.before !== undefined ? JSON.stringify(d.before) : null,
    d.after !== undefined ? JSON.stringify(d.after) : null,
    d.reason ?? null, d.operational_date ?? null, nowISO());
}
export function listHandoverEvents(companyIds: number[] | undefined, filters?: { entity_type?: string; entity_id?: number; operational_date?: string; limit?: number }): HandoverEvent[] {
  const where: string[] = []; const vals: unknown[] = [];
  if (companyIds !== undefined) {
    if (companyIds.length === 0) return [];
    where.push(`company_id IN (${inClause(companyIds)})`); vals.push(...companyIds);
  }
  if (filters?.entity_type) { where.push('entity_type = ?'); vals.push(filters.entity_type); }
  if (filters?.entity_id) { where.push('entity_id = ?'); vals.push(filters.entity_id); }
  if (filters?.operational_date) { where.push('operational_date = ?'); vals.push(filters.operational_date); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters?.limit ?? 200, 1), 1000);
  return getDb().prepare(`SELECT * FROM handover_events ${clause} ORDER BY id DESC LIMIT ?`).all(...vals, limit) as HandoverEvent[];
}

// ── Idempotency ──────────────────────────────────────────────────────────────
export function getIdempotentResult(key: string, companyId: number, scope: string): number | null {
  const row = getDb().prepare(
    'SELECT result_id FROM handover_idempotency WHERE key = ? AND company_id = ? AND scope = ?',
  ).get(key, companyId, scope) as { result_id: number } | undefined;
  return row ? row.result_id : null;
}
export function putIdempotentResult(key: string, companyId: number, scope: string, resultId: number): void {
  try {
    getDb().prepare('INSERT INTO handover_idempotency (key, company_id, scope, result_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(key, companyId, scope, resultId, nowISO());
  } catch { /* duplicate key = another writer won the race; ignore */ }
}

export { getDb };

/**
 * Shift Handover — persistence layer.
 *
 * Portal-only: every row lives in the shared portal SQLite DB (data/portal.db)
 * via getDb(). No Odoo dependency. Three small tables model the whole module:
 *   handover_log_types    — manager-configurable entry chips (emoji + name)
 *   handover_log_entries  — the daily feed (a note and/or photos)
 *   handover_storage_items— persistent "In storage now", lives until marked used
 * Photos reuse the shared handover_photos table (entity_type = 'log_entry').
 *
 * Follows the inventory-db.ts conventions: idempotent initHandoverTables()
 * called at the top of each API route (CREATE ... IF NOT EXISTS + guarded ALTER
 * migrations), snake_case `handover_` tables, integer booleans, ISO timestamps.
 */
import { getDb } from '@/lib/db';
import type { LogType, LogEntry, StorageItem, HandoverPhoto } from './types';

export function nowISO(): string {
  return new Date().toISOString();
}
const b = (v: unknown) => (v ? 1 : 0);

/** The out-of-the-box entry types seeded for a restaurant on first use. */
export const DEFAULT_LOG_TYPES: Array<{ name: string; emoji: string; is_alert?: boolean; is_storage?: boolean }> = [
  { name: 'Cooked', emoji: '🍗' },
  { name: 'Stored', emoji: '🧊', is_storage: true },
  { name: 'Cleaned', emoji: '🧽' },
  { name: 'Oil changed', emoji: '🛢️' },
  { name: 'Heads-up', emoji: '⚠️', is_alert: true },
  { name: 'Note', emoji: '📝' },
];

let _inited = false;

export function initHandoverTables(): void {
  const db = getDb();
  if (_inited) return;
  try { db.pragma('busy_timeout = 5000'); } catch { /* best effort */ }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS handover_log_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '📝',
        is_alert INTEGER NOT NULL DEFAULT 0,
        is_storage INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_log_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        operational_date TEXT NOT NULL,
        type_id INTEGER,
        type_name TEXT NOT NULL,
        type_emoji TEXT NOT NULL DEFAULT '📝',
        is_alert INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        storage_item_id INTEGER,
        author_user_id INTEGER,
        author_name TEXT,
        acknowledged_by_user_id INTEGER,
        acknowledged_by_name TEXT,
        acknowledged_at TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        edited_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handover_storage_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        location_text TEXT,
        use_first INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'here',
        entry_id INTEGER,
        added_by_user_id INTEGER,
        added_by_name TEXT,
        added_at TEXT NOT NULL,
        used_by_user_id INTEGER,
        used_by_name TEXT,
        used_at TEXT,
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

      CREATE TABLE IF NOT EXISTS handover_idempotency (
        key TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        scope TEXT NOT NULL,
        result_id INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (key, company_id, scope)
      );

      CREATE INDEX IF NOT EXISTS idx_ho_types_co ON handover_log_types(company_id, active, sort_order);
      CREATE INDEX IF NOT EXISTS idx_ho_entries_co_date ON handover_log_entries(company_id, operational_date, active);
      CREATE INDEX IF NOT EXISTS idx_ho_storage_co_status ON handover_storage_items(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_ho_photos_entity ON handover_photos(entity_type, entity_id);
    `);
  } catch (e) {
    console.error('[shift-handover] table/index init error (continuing to migrate):', e);
  }

  migrateHandoverSchema();
  _inited = true;
}

/** Additive, idempotent migrations for future columns (inventory-db.ts idiom). */
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
  // New columns go here, e.g. addColumn('handover_log_types', 'colour', 'colour TEXT');
  void addColumn;
}

// ── Log types ────────────────────────────────────────────────────────────────
/** Seed the six default types the first time a restaurant opens the module. */
export function ensureDefaultLogTypes(companyId: number): void {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) AS n FROM handover_log_types WHERE company_id = ?').get(companyId) as { n: number };
  if (existing.n > 0) return;
  const ts = nowISO();
  const insert = db.prepare(
    `INSERT INTO handover_log_types (company_id, name, emoji, is_alert, is_storage, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const seed = db.transaction(() => {
    DEFAULT_LOG_TYPES.forEach((t, i) => insert.run(companyId, t.name, t.emoji, b(t.is_alert), b(t.is_storage), i + 1, ts, ts));
  });
  try { seed(); } catch (e) { console.error('[shift-handover] seed default types failed:', e); }
}

export function listLogTypes(companyId: number, opts?: { includeInactive?: boolean }): LogType[] {
  const where = opts?.includeInactive ? '' : 'AND active = 1';
  return getDb().prepare(
    `SELECT * FROM handover_log_types WHERE company_id = ? ${where} ORDER BY sort_order, id`,
  ).all(companyId) as LogType[];
}
export function getLogType(id: number): LogType | null {
  return (getDb().prepare('SELECT * FROM handover_log_types WHERE id = ?').get(id) as LogType) ?? null;
}
export function nextTypeSortOrder(companyId: number): number {
  const r = getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM handover_log_types WHERE company_id = ?').get(companyId) as { m: number };
  return r.m + 1;
}
export function createLogType(d: { company_id: number; name: string; emoji: string; is_alert?: boolean; is_storage?: boolean; sort_order?: number }): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_log_types (company_id, name, emoji, is_alert, is_storage, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(d.company_id, d.name, d.emoji || '📝', b(d.is_alert), b(d.is_storage), d.sort_order ?? 0, ts, ts);
  return r.lastInsertRowid as number;
}
export function updateLogType(id: number, companyId: number, d: Partial<{ name: string; emoji: string; is_alert: boolean; sort_order: number; active: boolean }>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (c: string, v: unknown) => { sets.push(`${c} = ?`); vals.push(v); };
  if (d.name !== undefined) put('name', d.name);
  if (d.emoji !== undefined) put('emoji', d.emoji);
  if (d.is_alert !== undefined) put('is_alert', b(d.is_alert));
  if (d.sort_order !== undefined) put('sort_order', d.sort_order);
  if (d.active !== undefined) put('active', b(d.active));
  if (!sets.length) return;
  put('updated_at', nowISO()); vals.push(id, companyId);
  getDb().prepare(`UPDATE handover_log_types SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}
/** How many active types can pin storage — used to stop deleting the last one. */
export function countActiveStorageTypes(companyId: number): number {
  const r = getDb().prepare('SELECT COUNT(*) AS n FROM handover_log_types WHERE company_id = ? AND active = 1 AND is_storage = 1').get(companyId) as { n: number };
  return r.n;
}

// ── Log entries ──────────────────────────────────────────────────────────────
export function createLogEntry(d: {
  company_id: number; operational_date: string; type_id: number | null; type_name: string;
  type_emoji: string; is_alert?: boolean; note?: string | null; storage_item_id?: number | null;
  author_user_id?: number | null; author_name?: string | null;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_log_entries (company_id, operational_date, type_id, type_name, type_emoji, is_alert, note, storage_item_id, author_user_id, author_name, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(d.company_id, d.operational_date, d.type_id, d.type_name, d.type_emoji || '📝', b(d.is_alert),
    d.note ?? null, d.storage_item_id ?? null, d.author_user_id ?? null, d.author_name ?? null, ts, ts);
  return r.lastInsertRowid as number;
}
export function getLogEntry(id: number): LogEntry | null {
  return (getDb().prepare('SELECT * FROM handover_log_entries WHERE id = ?').get(id) as LogEntry) ?? null;
}
export function listLogEntries(companyId: number, operationalDate: string): LogEntry[] {
  return getDb().prepare(
    `SELECT * FROM handover_log_entries WHERE company_id = ? AND operational_date = ? AND active = 1 ORDER BY created_at DESC, id DESC`,
  ).all(companyId, operationalDate) as LogEntry[];
}
export function recentEntryDates(companyId: number, limit = 30): string[] {
  const rows = getDb().prepare(
    `SELECT DISTINCT operational_date FROM handover_log_entries WHERE company_id = ? AND active = 1 ORDER BY operational_date DESC LIMIT ?`,
  ).all(companyId, Math.min(Math.max(limit, 1), 120)) as { operational_date: string }[];
  return rows.map((r) => r.operational_date);
}
export function updateLogEntryNote(id: number, companyId: number, note: string | null): void {
  const ts = nowISO();
  getDb().prepare('UPDATE handover_log_entries SET note = ?, edited_at = ?, updated_at = ? WHERE id = ? AND company_id = ?')
    .run(note, ts, ts, id, companyId);
}
export function softDeleteLogEntry(id: number, companyId: number): void {
  getDb().prepare('UPDATE handover_log_entries SET active = 0, updated_at = ? WHERE id = ? AND company_id = ?')
    .run(nowISO(), id, companyId);
}
export function setEntryStorageItem(id: number, companyId: number, storageItemId: number): void {
  getDb().prepare('UPDATE handover_log_entries SET storage_item_id = ? WHERE id = ? AND company_id = ?').run(storageItemId, id, companyId);
}
/** Mark an entry as edited without changing its note (e.g. a photos-only edit). */
export function touchEntryEdited(id: number, companyId: number): void {
  const ts = nowISO();
  getDb().prepare('UPDATE handover_log_entries SET edited_at = ?, updated_at = ? WHERE id = ? AND company_id = ?').run(ts, ts, id, companyId);
}
/** Clear a stale acknowledgement (the alert's content changed after it was read). */
export function clearEntryAck(id: number, companyId: number): void {
  getDb().prepare('UPDATE handover_log_entries SET acknowledged_by_user_id = NULL, acknowledged_by_name = NULL, acknowledged_at = NULL, updated_at = ? WHERE id = ? AND company_id = ?')
    .run(nowISO(), id, companyId);
}
/** Acknowledge an alert entry once. Returns false if it was already acknowledged. */
export function acknowledgeEntry(id: number, companyId: number, actor: { userId: number; name: string }): boolean {
  const ts = nowISO();
  const r = getDb().prepare(
    `UPDATE handover_log_entries SET acknowledged_by_user_id = ?, acknowledged_by_name = ?, acknowledged_at = ?, updated_at = ?
     WHERE id = ? AND company_id = ? AND is_alert = 1 AND acknowledged_at IS NULL`,
  ).run(actor.userId, actor.name, ts, ts, id, companyId);
  return r.changes > 0;
}

// ── Storage items ────────────────────────────────────────────────────────────
export interface StorageItemView extends StorageItem { photo: string | null }

export function createStorageItem(d: {
  company_id: number; name: string; location_text?: string | null; use_first?: boolean;
  entry_id?: number | null; added_by_user_id?: number | null; added_by_name?: string | null;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_storage_items (company_id, name, location_text, use_first, status, entry_id, added_by_user_id, added_by_name, added_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'here', ?, ?, ?, ?, ?, ?)`,
  ).run(d.company_id, d.name, d.location_text ?? null, b(d.use_first), d.entry_id ?? null,
    d.added_by_user_id ?? null, d.added_by_name ?? null, ts, ts, ts);
  return r.lastInsertRowid as number;
}
export function getStorageItem(id: number): StorageItem | null {
  return (getDb().prepare('SELECT * FROM handover_storage_items WHERE id = ?').get(id) as StorageItem) ?? null;
}
/** Everything currently in storage (persists across days), with a thumbnail from its entry. */
export function listStorageHere(companyId: number): StorageItemView[] {
  return getDb().prepare(
    `SELECT s.*, (
        SELECT p.photo FROM handover_photos p
        WHERE p.entity_type = 'log_entry' AND p.entity_id = s.entry_id AND p.active = 1
        ORDER BY p.id DESC LIMIT 1
     ) AS photo
     FROM handover_storage_items s
     WHERE s.company_id = ? AND s.status = 'here'
     ORDER BY s.use_first DESC, s.added_at DESC, s.id DESC`,
  ).all(companyId) as StorageItemView[];
}
/** Mark used once. Returns false if it was already used. */
export function markStorageUsed(id: number, companyId: number, actor: { userId: number; name: string }): boolean {
  const ts = nowISO();
  const r = getDb().prepare(
    `UPDATE handover_storage_items SET status = 'used', used_by_user_id = ?, used_by_name = ?, used_at = ?, updated_at = ?
     WHERE id = ? AND company_id = ? AND status = 'here'`,
  ).run(actor.userId, actor.name, ts, ts, id, companyId);
  return r.changes > 0;
}

// ── Photos ───────────────────────────────────────────────────────────────────
export const MAX_PHOTOS = 5;
// ~2.6 MB decoded. PhotoCaptureStrip resizes to 1280px @ 0.7 JPEG (typically well
// under 500 KB), so a legitimate capture never approaches this ceiling.
const MAX_PHOTO_CHARS = 3_500_000;

/**
 * Keep only inline raster data URLs within the size + count caps. Silently drops
 * anything else — remote `http(s)` URLs (which would make clients fetch attacker
 * content) and oversized blobs (which would bloat the DB) never get stored.
 */
export function filterValidPhotos(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const p of input) {
    if (typeof p !== 'string' || !p.startsWith('data:image/') || p.length > MAX_PHOTO_CHARS) continue;
    out.push(p);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

export function addPhoto(d: {
  company_id: number; entity_type: string; entity_id: number; event?: string | null;
  photo: string; uploaded_by_user_id?: number | null; uploaded_by_name?: string | null;
}): number {
  const r = getDb().prepare(
    `INSERT INTO handover_photos (company_id, entity_type, entity_id, event, photo, caption, uploaded_by_user_id, uploaded_by_name, uploaded_at, active, replaced_photo_id)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, NULL)`,
  ).run(d.company_id, d.entity_type, d.entity_id, d.event ?? null, d.photo,
    d.uploaded_by_user_id ?? null, d.uploaded_by_name ?? null, nowISO());
  return r.lastInsertRowid as number;
}
export function listPhotos(entityType: string, entityId: number): HandoverPhoto[] {
  return getDb().prepare(
    `SELECT * FROM handover_photos WHERE entity_type = ? AND entity_id = ? AND active = 1 ORDER BY id`,
  ).all(entityType, entityId) as HandoverPhoto[];
}
/** All active photos for a set of entities, for batch feed rendering. */
export function listPhotosForEntities(entityType: string, ids: number[]): HandoverPhoto[] {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return getDb().prepare(
    `SELECT * FROM handover_photos WHERE entity_type = ? AND entity_id IN (${ph}) AND active = 1 ORDER BY entity_id, id`,
  ).all(entityType, ...ids) as HandoverPhoto[];
}
export function deactivatePhotosFor(entityType: string, entityId: number, companyId: number): void {
  getDb().prepare('UPDATE handover_photos SET active = 0 WHERE entity_type = ? AND entity_id = ? AND company_id = ?')
    .run(entityType, entityId, companyId);
}

// ── Idempotency ──────────────────────────────────────────────────────────────
export function getIdempotentResult(key: string, companyId: number, scope: string): number | null {
  const row = getDb().prepare(
    'SELECT result_id FROM handover_idempotency WHERE key = ? AND company_id = ? AND scope = ?',
  ).get(key, companyId, scope) as { result_id: number } | undefined;
  return row ? row.result_id : null;
}
/**
 * Claim an idempotency key. THROWS a UNIQUE-constraint error if the key is already
 * taken — call this INSIDE the create transaction so a concurrent retry rolls the
 * whole entry back instead of writing a duplicate. Fill in the id with
 * setIdempotencyResult once the row is created.
 */
export function claimIdempotency(key: string, companyId: number, scope: string): void {
  getDb().prepare('INSERT INTO handover_idempotency (key, company_id, scope, result_id, created_at) VALUES (?, ?, ?, NULL, ?)')
    .run(key, companyId, scope, nowISO());
}
export function setIdempotencyResult(key: string, companyId: number, scope: string, resultId: number): void {
  getDb().prepare('UPDATE handover_idempotency SET result_id = ? WHERE key = ? AND company_id = ? AND scope = ?')
    .run(resultId, key, companyId, scope);
}

export { getDb };

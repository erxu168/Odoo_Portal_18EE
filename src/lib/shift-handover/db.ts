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
import type { LogType, LogEntry, StorageItem, HandoverPhoto, LookupItem } from './types';

export function nowISO(): string {
  return new Date().toISOString();
}
const b = (v: unknown) => (v ? 1 : 0);

/** The out-of-the-box entry types seeded for a restaurant on first use. */
export const DEFAULT_LOG_TYPES: Array<{ name: string; emoji: string; is_alert?: boolean; is_storage?: boolean }> = [
  { name: 'Prepped', emoji: '🧊', is_storage: true },
  { name: 'Cleaned', emoji: '🧽' },
  { name: 'Oil changed', emoji: '🛢️' },
  { name: 'Heads-up', emoji: '⚠️', is_alert: true },
  { name: 'Note', emoji: '📝' },
];

/**
 * Seeded "lookup" lists a manager can rename/reorder/add to. Two kinds share one
 * table: the "What is it?" dropdown for prepped items, and the required unit list.
 */
export type LookupKind = 'prepped_item' | 'unit';
export const DEFAULT_PREPPED_ITEMS: string[] = [
  'Jerk Chicken', 'Rice & Peas', 'Coleslaw', 'Festival', 'Fried Plantain',
  'Jerk Pork', 'Curry Goat', 'Gravy', 'Slaw Dressing', 'Jerk Sauce',
];
// Sorted: loose measures first, then gastronorm pans largest → smallest.
export const DEFAULT_UNITS: string[] = [
  'kg', 'pieces', 'bags', 'GN 1/1', 'GN 1/2', 'GN 1/3', 'GN 1/4', 'GN 1/6', 'GN 1/8',
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

      -- Manager-editable lookup lists: kind = 'prepped_item' (the "What is it?"
      -- dropdown) or 'unit' (the required amount unit).
      CREATE TABLE IF NOT EXISTS handover_lookups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        norm TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (company_id, kind, norm)
      );

      -- Small key/value store for one-time data migrations (no user_version).
      CREATE TABLE IF NOT EXISTS handover_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ho_types_co ON handover_log_types(company_id, active, sort_order);
      CREATE INDEX IF NOT EXISTS idx_ho_entries_co_date ON handover_log_entries(company_id, operational_date, active);
      CREATE INDEX IF NOT EXISTS idx_ho_storage_co_status ON handover_storage_items(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_ho_photos_entity ON handover_photos(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_ho_lookups_co_kind ON handover_lookups(company_id, kind, active, sort_order);
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
  // The place an item is stored, as a real location rather than typed words.
  // `location_text` stays: it holds the words already typed on old entries, and
  // for new ones it holds the full path AS IT READ when the item was put away,
  // so history still makes sense after a shelf is renamed or removed.
  addColumn('handover_storage_items', 'location_id', 'location_id INTEGER');
  // Prepped items now carry a required amount + unit, an optional prepared-on
  // date, and a link back to the picked catalogue item (null when typed as Other).
  addColumn('handover_storage_items', 'amount', 'amount REAL');
  addColumn('handover_storage_items', 'unit', 'unit TEXT');
  addColumn('handover_storage_items', 'prepared_on', 'prepared_on TEXT');
  addColumn('handover_storage_items', 'item_id', 'item_id INTEGER');
  // Why it left the tray when cleared: 'moved_out' | 'used_up' | 'discarded'.
  addColumn('handover_storage_items', 'cleared_reason', 'cleared_reason TEXT');
  // Backfill a prepared-on date for rows that predate the field: prefer the
  // linked log entry's operational (Berlin) date, else the added-at day.
  try { getDb().exec("UPDATE handover_storage_items SET prepared_on = COALESCE((SELECT operational_date FROM handover_log_entries WHERE id = handover_storage_items.entry_id), substr(added_at, 1, 10)) WHERE prepared_on IS NULL AND added_at IS NOT NULL"); } catch { /* best effort */ }

  // One-time data fix for restaurants seeded before the rename: turn the storage
  // type "Stored" into "Prepped", and retire the default "Cooked" chip (kept
  // reversible via active=0). Guarded so a manager who later re-creates either is
  // never touched again.
  // Match the EXACT seeded defaults (name + flags + emoji) so a manager-created
  // "Cooked"/"Stored" chip with a different symbol is never touched.
  runOnceMigration('prepped_rename_v1', () => {
    const ts = nowISO();
    db.prepare("UPDATE handover_log_types SET name = 'Prepped', updated_at = ? WHERE name = 'Stored' AND is_storage = 1 AND is_alert = 0 AND emoji = '🧊'").run(ts);
    db.prepare("UPDATE handover_log_types SET active = 0, updated_at = ? WHERE name = 'Cooked' AND is_storage = 0 AND is_alert = 0 AND emoji = '🍗'").run(ts);
  });
}

/** Run `fn` exactly once ever (tracked in handover_meta), for data migrations. */
function runOnceMigration(key: string, fn: () => void): void {
  const db = getDb();
  try {
    const done = db.prepare('SELECT 1 FROM handover_meta WHERE key = ?').get(key);
    if (done) return;
    const tx = db.transaction(() => {
      fn();
      db.prepare('INSERT OR IGNORE INTO handover_meta (key, value, created_at) VALUES (?, ?, ?)').run(key, 'done', nowISO());
    });
    tx();
  } catch (e) {
    console.error(`[shift-handover] one-time migration ${key} failed:`, e);
  }
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

// ── Lookup lists (prepped items + units) ─────────────────────────────────────
/** Case/whitespace-folded key so "Coleslaw" and " coleslaw " can't both exist. */
export function normalizeLookup(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Seed a company's default items/units the first time it opens the module. */
export function ensureDefaultLookups(companyId: number): void {
  const db = getDb();
  const seedKind = (kind: LookupKind, names: string[]) => {
    const existing = db.prepare('SELECT COUNT(*) AS n FROM handover_lookups WHERE company_id = ? AND kind = ?').get(companyId, kind) as { n: number };
    if (existing.n > 0) return;
    const ts = nowISO();
    const insert = db.prepare('INSERT OR IGNORE INTO handover_lookups (company_id, kind, name, norm, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
    const tx = db.transaction(() => names.forEach((name, i) => insert.run(companyId, kind, name, normalizeLookup(name), i + 1, ts, ts)));
    try { tx(); } catch (e) { console.error(`[shift-handover] seed ${kind} failed:`, e); }
  };
  seedKind('prepped_item', DEFAULT_PREPPED_ITEMS);
  seedKind('unit', DEFAULT_UNITS);
}

export function listLookups(companyId: number, kind: LookupKind, opts?: { includeInactive?: boolean }): LookupItem[] {
  const where = opts?.includeInactive ? '' : 'AND active = 1';
  return getDb().prepare(
    `SELECT * FROM handover_lookups WHERE company_id = ? AND kind = ? ${where} ORDER BY sort_order, id`,
  ).all(companyId, kind) as LookupItem[];
}
export function getLookup(id: number): LookupItem | null {
  return (getDb().prepare('SELECT * FROM handover_lookups WHERE id = ?').get(id) as LookupItem) ?? null;
}
export function findLookupByName(companyId: number, kind: LookupKind, name: string): LookupItem | null {
  return (getDb().prepare('SELECT * FROM handover_lookups WHERE company_id = ? AND kind = ? AND norm = ?')
    .get(companyId, kind, normalizeLookup(name)) as LookupItem) ?? null;
}
export function nextLookupSortOrder(companyId: number, kind: LookupKind): number {
  const r = getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM handover_lookups WHERE company_id = ? AND kind = ?').get(companyId, kind) as { m: number };
  return r.m + 1;
}
/**
 * Add a lookup, or REACTIVATE (and re-label) a retired one with the same folded
 * name — so deleting then re-adding "Coleslaw" restores it instead of colliding
 * with the UNIQUE (company_id, kind, norm) constraint. Returns the row id.
 */
export function createLookup(d: { company_id: number; kind: LookupKind; name: string; sort_order?: number }): number {
  const existing = findLookupByName(d.company_id, d.kind, d.name);
  if (existing) {
    updateLookup(existing.id, d.company_id, { name: d.name, active: true });
    return existing.id;
  }
  const ts = nowISO();
  const r = getDb().prepare(
    'INSERT INTO handover_lookups (company_id, kind, name, norm, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
  ).run(d.company_id, d.kind, d.name, normalizeLookup(d.name), d.sort_order ?? 0, ts, ts);
  return r.lastInsertRowid as number;
}
/** Rename/reorder/retire. Recomputes `norm` on rename; throws on a name clash. */
export function updateLookup(id: number, companyId: number, d: Partial<{ name: string; sort_order: number; active: boolean }>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (c: string, v: unknown) => { sets.push(`${c} = ?`); vals.push(v); };
  if (d.name !== undefined) { put('name', d.name); put('norm', normalizeLookup(d.name)); }
  if (d.sort_order !== undefined) put('sort_order', d.sort_order);
  if (d.active !== undefined) put('active', b(d.active));
  if (!sets.length) return;
  put('updated_at', nowISO()); vals.push(id, companyId);
  getDb().prepare(`UPDATE handover_lookups SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}
/** Keep at least one row so a required dropdown is never empty. */
export function countActiveLookups(companyId: number, kind: LookupKind): number {
  const r = getDb().prepare('SELECT COUNT(*) AS n FROM handover_lookups WHERE company_id = ? AND kind = ? AND active = 1').get(companyId, kind) as { n: number };
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
  company_id: number; name: string; location_id?: number | null; location_text?: string | null;
  use_first?: boolean; amount?: number | null; unit?: string | null; prepared_on?: string | null;
  item_id?: number | null;
  entry_id?: number | null; added_by_user_id?: number | null; added_by_name?: string | null;
}): number {
  const ts = nowISO();
  const r = getDb().prepare(
    `INSERT INTO handover_storage_items (company_id, name, location_id, location_text, use_first, amount, unit, prepared_on, item_id, status, entry_id, added_by_user_id, added_by_name, added_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'here', ?, ?, ?, ?, ?, ?)`,
  ).run(d.company_id, d.name, d.location_id ?? null, d.location_text ?? null, b(d.use_first),
    d.amount ?? null, d.unit ?? null, d.prepared_on ?? null, d.item_id ?? null, d.entry_id ?? null,
    d.added_by_user_id ?? null, d.added_by_name ?? null, ts, ts, ts);
  return r.lastInsertRowid as number;
}
export function getStorageItem(id: number): StorageItem | null {
  return (getDb().prepare('SELECT * FROM handover_storage_items WHERE id = ?').get(id) as StorageItem) ?? null;
}
/** One storage item with its entry's thumbnail, for the detail sheet. */
export function getStorageItemView(id: number, companyId: number): StorageItemView | null {
  return (getDb().prepare(
    `SELECT s.*, (
        SELECT p.photo FROM handover_photos p
        WHERE p.entity_type = 'log_entry' AND p.entity_id = s.entry_id AND p.active = 1
        ORDER BY p.id DESC LIMIT 1
     ) AS photo
     FROM handover_storage_items s WHERE s.id = ? AND s.company_id = ?`,
  ).get(id, companyId) as StorageItemView) ?? null;
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
/** Edit a storage item's details (name/amount/unit/place/use-first/prepared-on). */
export function updateStorageItem(id: number, companyId: number, d: Partial<{
  name: string; amount: number | null; unit: string | null; location_id: number | null;
  location_text: string | null; use_first: boolean; prepared_on: string | null; item_id: number | null;
}>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (c: string, v: unknown) => { sets.push(`${c} = ?`); vals.push(v); };
  if (d.name !== undefined) put('name', d.name);
  if (d.amount !== undefined) put('amount', d.amount);
  if (d.unit !== undefined) put('unit', d.unit);
  if (d.location_id !== undefined) put('location_id', d.location_id);
  if (d.location_text !== undefined) put('location_text', d.location_text);
  if (d.use_first !== undefined) put('use_first', b(d.use_first));
  if (d.prepared_on !== undefined) put('prepared_on', d.prepared_on);
  if (d.item_id !== undefined) put('item_id', d.item_id);
  if (!sets.length) return;
  put('updated_at', nowISO()); vals.push(id, companyId);
  getDb().prepare(`UPDATE handover_storage_items SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}
/**
 * Remove an item outright (a mistake, not "used"): status = 'deleted'. Only acts
 * on an item that is still HERE, so deleting a note never overwrites the
 * moved-out/used-up/discarded audit of an already-cleared item.
 */
export function softDeleteStorageItem(id: number, companyId: number): void {
  getDb().prepare("UPDATE handover_storage_items SET status = 'deleted', updated_at = ? WHERE id = ? AND company_id = ? AND status = 'here'")
    .run(nowISO(), id, companyId);
}
/** How an item left the tray when a staff member cleared it. */
export type ClearReason = 'moved_out' | 'used_up' | 'discarded';
export const CLEAR_REASONS: ClearReason[] = ['moved_out', 'used_up', 'discarded'];

/** Clear an item from the tray with a reason. Returns false if it was already gone. */
export function markStorageUsed(id: number, companyId: number, actor: { userId: number; name: string }, reason: ClearReason): boolean {
  const ts = nowISO();
  const r = getDb().prepare(
    `UPDATE handover_storage_items SET status = 'used', cleared_reason = ?, used_by_user_id = ?, used_by_name = ?, used_at = ?, updated_at = ?
     WHERE id = ? AND company_id = ? AND status = 'here'`,
  ).run(reason, actor.userId, actor.name, ts, ts, id, companyId);
  return r.changes > 0;
}
/** How long after clearing an item the "Undo" still works (a real undo, not a
 *  way to resurrect days-old stock). */
export const UNDO_WINDOW_MS = 120_000;
/** Undo a clear: put a JUST-cleared item back. False once the undo window passes. */
export function restoreStorageItem(id: number, companyId: number): boolean {
  const cutoff = new Date(Date.now() - UNDO_WINDOW_MS).toISOString();
  const r = getDb().prepare(
    `UPDATE handover_storage_items SET status = 'here', cleared_reason = NULL, used_by_user_id = NULL, used_by_name = NULL, used_at = NULL, updated_at = ?
     WHERE id = ? AND company_id = ? AND status = 'used' AND used_at >= ?`,
  ).run(nowISO(), id, companyId, cutoff);
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

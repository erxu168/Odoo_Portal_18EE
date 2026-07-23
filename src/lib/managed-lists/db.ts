/**
 * Generic storage for "managed lists" — small, user-editable option lists that
 * live only in the portal (delivery-issue types, skip-count reasons, and future
 * ones). One table keyed by (list_key, company_id) powers them all, so adding a
 * new managed list never needs a new table. company_id = 0 means a GLOBAL list.
 *
 * Uniqueness is enforced by a DB index on a normalized key (NFC + case-folded),
 * so it is both Unicode-correct and race-safe. A separate `managed_list_seeded`
 * marker distinguishes "never initialized" from "intentionally emptied" — so
 * deleting the last item does NOT resurrect the defaults.
 */
import { getDb } from '@/lib/db';

function now(): string { return new Date().toISOString(); }
function normalize(s: string): string { return s.normalize('NFC').replace(/\s+/g, ' ').trim(); }
function codePointLen(s: string): number { return Array.from(s).length; }
const MAX_LEN = 60; // code points

export interface ManagedItem { id: number; label: string; sort_order: number }

export function initManagedLists(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS managed_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_key TEXT NOT NULL,
      company_id INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL,
      norm TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_list_uniq ON managed_list_items (list_key, company_id, norm);
    CREATE INDEX IF NOT EXISTS idx_managed_list ON managed_list_items (list_key, company_id);
    CREATE TABLE IF NOT EXISTS managed_list_seeded (
      list_key TEXT NOT NULL,
      company_id INTEGER NOT NULL DEFAULT 0,
      seeded_at TEXT NOT NULL,
      PRIMARY KEY (list_key, company_id)
    );
  `);
}

/** List a managed list's items, seeding the defaults ONCE (per company). */
export function listManagedItems(listKey: string, companyId: number, seed?: string[]): ManagedItem[] {
  const db = getDb();
  if (seed && seed.length) {
    db.transaction(() => {
      const already = db.prepare('SELECT 1 FROM managed_list_seeded WHERE list_key = ? AND company_id = ?').get(listKey, companyId);
      if (!already) {
        const ins = db.prepare('INSERT OR IGNORE INTO managed_list_items (list_key, company_id, label, norm, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        seed.forEach((l, i) => { const c = normalize(l); ins.run(listKey, companyId, c, c.toLowerCase(), (i + 1) * 10, now()); });
        db.prepare('INSERT OR IGNORE INTO managed_list_seeded (list_key, company_id, seeded_at) VALUES (?, ?, ?)').run(listKey, companyId, now());
      }
    })();
  }
  return db.prepare(
    'SELECT id, label, sort_order FROM managed_list_items WHERE list_key = ? AND company_id = ? ORDER BY sort_order, id'
  ).all(listKey, companyId) as ManagedItem[];
}

/** Add an item; null on a duplicate (enforced by the unique index) or bad label. */
export function addManagedItem(listKey: string, companyId: number, label: string, userId: number): ManagedItem | null {
  const db = getDb();
  const clean = normalize(label);
  if (!clean || codePointLen(clean) > MAX_LEN) return null;
  const norm = clean.toLowerCase();
  try {
    return db.transaction(() => {
      const maxSort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM managed_list_items WHERE list_key = ? AND company_id = ?').get(listKey, companyId) as { m: number }).m;
      const r = db.prepare('INSERT INTO managed_list_items (list_key, company_id, label, norm, sort_order, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(listKey, companyId, clean, norm, maxSort + 10, userId, now());
      return { id: r.lastInsertRowid as number, label: clean, sort_order: maxSort + 10 };
    })();
  } catch {
    return null; // unique-index violation → duplicate
  }
}

/** Rename an item; { dupe:true } if the new name collides (unique index). */
export function renameManagedItem(id: number, listKey: string, companyId: number, label: string): { ok: boolean; dupe?: boolean } {
  const db = getDb();
  const clean = normalize(label);
  if (!clean || codePointLen(clean) > MAX_LEN) return { ok: false };
  const exists = db.prepare('SELECT 1 FROM managed_list_items WHERE id = ? AND list_key = ? AND company_id = ?').get(id, listKey, companyId);
  if (!exists) return { ok: false };
  try {
    db.prepare('UPDATE managed_list_items SET label = ?, norm = ? WHERE id = ? AND list_key = ? AND company_id = ?')
      .run(clean, clean.toLowerCase(), id, listKey, companyId);
    return { ok: true };
  } catch {
    return { ok: false, dupe: true }; // unique-index violation → collides with another item
  }
}

/** Delete an item. Safe: past records keep their stored free-text value. */
export function deleteManagedItem(id: number, listKey: string, companyId: number): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM managed_list_items WHERE id = ? AND list_key = ? AND company_id = ?').run(id, listKey, companyId).changes > 0;
}

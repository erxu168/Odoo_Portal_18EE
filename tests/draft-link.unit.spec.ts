import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Joining a scanned draft to the real product it turned out to be.
 *
 * This was withheld from the setup queue because the endpoint could corrupt a
 * count three ways. Real database, real SQL — a mock cannot catch a missed table.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-link-'));
process.env.PORTAL_DB_PATH = path.join(dir, 'portal.db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../src/lib/inventory-db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const raw = () => require('../src/lib/db').getDb();

const DRAFT = 90001, TARGET = 90002, SPOT = 7;
let session = 0;

test.beforeAll(() => {
  db.initInventoryTables();
  const h = raw();
  // A template first — counting_sessions.template_id is NOT NULL with an FK.
  h.prepare(`INSERT INTO counting_templates (name, location_id, company_id, frequency, product_ids, created_by, created_at, updated_at)
             VALUES ('ZZ link test', 1, 6, 'adhoc', '[]', 1, '2026-07-30', '2026-07-30')`).run();
  const tmpl = h.prepare('SELECT MAX(id) AS id FROM counting_templates').get().id;
  h.prepare(`INSERT INTO counting_sessions (template_id, scheduled_date, status, location_id, company_id, created_at)
             VALUES (?, '2026-07-30', 'in_progress', 1, 6, '2026-07-30')`).run(tmpl);
  session = h.prepare('SELECT MAX(id) AS id FROM counting_sessions').get().id;
});

function addEntry(product: number, spot: number | null, qty: number) {
  raw().prepare(`INSERT INTO count_entries (session_id, product_id, count_location_id, counted_qty, uom, counted_by, counted_at)
                 VALUES (?, ?, ?, ?, 'kg', 1, '2026-07-30')`).run(session, product, spot, qty);
}
function addScope(product: number, spot = SPOT) {
  // count_location_id is NOT NULL — the frozen scope is per (count, product, spot),
  // which is what makes multi-spot counting work.
  raw().prepare(`INSERT INTO session_count_items (session_id, odoo_product_id, count_location_id)
                 VALUES (?, ?, ?)`).run(session, product, spot);
}
const scopeIds = () => raw().prepare('SELECT odoo_product_id AS p FROM session_count_items WHERE session_id = ?')
  .all(session).map((r: { p: number }) => r.p);
const entryFor = (p: number) => raw().prepare('SELECT counted_qty q FROM count_entries WHERE session_id = ? AND product_id = ?')
  .all(session, p) as { q: number }[];

test('THE BUG: the frozen scope follows the entry, or the count can never be approved', () => {
  // A count records which products it covers when it starts. Approval refuses a
  // line for anything outside that list. Moving the entry and leaving the scope
  // naming the draft produced a line that could never be approved — the count
  // was silently unfinishable.
  addEntry(DRAFT, SPOT, 5);
  addScope(DRAFT);
  expect(scopeIds()).toContain(DRAFT);

  const moved = db.reassignCountsForProduct(DRAFT, TARGET);
  expect(moved).toBe(1);
  expect(entryFor(TARGET).map((e) => e.q)).toEqual([5]);
  expect(entryFor(DRAFT)).toEqual([]);
  expect(scopeIds(), 'the scope must now name the TARGET').toContain(TARGET);
  expect(scopeIds(), 'and must not still name the draft').not.toContain(DRAFT);
});

test('a collision is REFUSED, not merged — and nothing is changed', () => {
  // Both counted at the same spot in the same count. Summing could double-count
  // the same physical items; keeping one silently discards a real observation.
  // Either way the manager cannot tell which happened, so it refuses.
  const D2 = 90003, T2 = 90004;
  addEntry(D2, SPOT, 4);
  addEntry(T2, SPOT, 9);
  addScope(D2); addScope(T2);

  expect(() => db.reassignCountsForProduct(D2, T2)).toThrow(/counted in the same place/i);
  // ATOMIC: the refusal left both entries exactly as they were.
  expect(entryFor(D2).map((e) => e.q)).toEqual([4]);
  expect(entryFor(T2).map((e) => e.q)).toEqual([9]);
  expect(scopeIds()).toContain(D2);
});

test('the same product at DIFFERENT spots is not a collision', () => {
  const D3 = 90005, T3 = 90006;
  addEntry(D3, 11, 2);
  addEntry(T3, 12, 3);
  const moved = db.reassignCountsForProduct(D3, T3);
  expect(moved).toBe(1);
  // Both lines survive, one per spot — multi-spot counting is the normal case.
  expect(entryFor(T3).map((e) => e.q).sort()).toEqual([2, 3]);
});

test('a draft with no counts at all joins cleanly', () => {
  expect(db.reassignCountsForProduct(90007, 90008)).toBe(0);
});

test('the scope row is removed rather than duplicated when the target is already in scope', () => {
  const D4 = 90009, T4 = 90010;
  addEntry(D4, 21, 1);
  addScope(D4); addScope(T4);
  db.reassignCountsForProduct(D4, T4);
  const ids = scopeIds();
  expect(ids.filter((p: number) => p === T4).length, 'exactly one scope row for the target').toBe(1);
  expect(ids).not.toContain(D4);
});

test.afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

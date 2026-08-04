import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * A skipped shelf must not silently lower a usage figure.
 *
 * The bug: usage is `start + received − binned − end`, and a product's figure is
 * the sum of its spots. A product kept in TWO places, where staff counted one
 * and skipped the other, returned just the counted spot's number — and marked
 * it complete. So the end count read LOW, and "used" read HIGH by exactly
 * whatever sat on the skipped shelf. Silently, on every report.
 *
 * A skip is a person saying "I didn't look here". That is the same kind of gap
 * as "couldn't find it", which the report already refuses to turn into a number.
 * Out-of-stock is different — "I looked, there is none" is a real zero and must
 * still count.
 *
 * These run the REAL totals rule against a throwaway database.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-usage-skip-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { getDb } = require('../src/lib/db');
const { initInventoryTables, createTemplate, createSession } = require('../src/lib/inventory-db');
// THE REAL RULE, not a copy — a mirrored implementation drifts from the route.
const { sessionTotals: totals } = require('../src/lib/usage-totals');

const WALKIN = 25;
const DRAWER = 38;
const ONION = 1600;
const NOW = '2026-08-03T20:00:00.000Z';

let seq = 0;
let templateId = 0;
function makeSession(opts: {
  lines: { pid: number; spot: number }[];
  entries: { pid: number; spot: number; qty: number; notFound?: boolean }[];
  skips?: number[];
}): number {
  const db = getDb();
  const id = createSession({
    template_id: templateId,
    scheduled_date: `2026-08-${String(10 + (seq++)).padStart(2, '0')}`,
    location_id: 60,
    company_id: 6,
    assigned_user_id: null,
  });
  // createSession snapshots the template's own lines; this fixture states its
  // frozen lines explicitly, so clear them first.
  db.prepare('DELETE FROM session_count_items WHERE session_id = ?').run(id);
  const loc = db.prepare(`INSERT OR IGNORE INTO session_count_locations
    (session_id, count_location_id, name, kind, walk_order) VALUES (?, ?, ?, ?, 0)`);
  const NAMES: Record<number, string> = { [WALKIN]: 'Walk in Cooler 1', [DRAWER]: 'D4', 0: 'Everything else' };
  Array.from(new Set([...opts.lines.map((l) => l.spot), ...(opts.skips || [])]))
    .forEach((sp) => loc.run(id, sp, NAMES[sp] || `Spot ${sp}`, null));
  const ins = db.prepare(`INSERT INTO session_count_items
    (session_id, odoo_product_id, count_location_id, shelf_sort, requires_photo)
    VALUES (?, ?, ?, 0, 0)`);
  opts.lines.forEach((l) => ins.run(id, l.pid, l.spot));
  const ent = db.prepare(`INSERT INTO count_entries
    (session_id, product_id, count_location_id, counted_qty, uom, not_found, counted_by, counted_at)
    VALUES (?, ?, ?, ?, 'kg', ?, 1, ?)`);
  opts.entries.forEach((e) => ent.run(id, e.pid, e.spot, e.qty, e.notFound ? 1 : 0, NOW));
  const st = db.prepare(`INSERT INTO session_location_status
    (session_id, count_location_id, status, skip_reason, updated_at)
    VALUES (?, ?, 'skipped', 'could not reach', ?)`);
  (opts.skips || []).forEach((s) => st.run(id, s, NOW));
  return id;
}

test.beforeAll(() => {
  initInventoryTables();
  const db = getDb();
  // Spots the frozen lines point at.
  db.prepare(`INSERT OR IGNORE INTO count_locations (id, name, kind, company_id, active, created_at)
              VALUES (?, ?, 'walkin', 6, 1, ?)`).run(WALKIN, 'Walk in Cooler 1', NOW);
  db.prepare(`INSERT OR IGNORE INTO count_locations (id, name, kind, company_id, active, created_at)
              VALUES (?, ?, 'drawer', 6, 1, ?)`).run(DRAWER, 'D4', NOW);
  templateId = createTemplate({
    name: 'Usage skip fixture', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: 60, company_id: 6, category_ids: [], product_ids: [ONION],
    assign_type: null, assign_id: null, created_by: 1,
  });
});

test('THE BUG: a product at two spots with one skipped gets NO figure, not a partial one', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }, { pid: ONION, spot: DRAWER }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 6 }],
    skips: [DRAWER],
  });
  const t = totals(s);
  expect(t.skipped.has(ONION), 'the skipped shelf must be reported').toBe(true);
  expect(ONION in t.qty, 'a partial sum must never be offered as the total').toBe(false);
});

test('a fully counted multi-spot product is untouched', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }, { pid: ONION, spot: DRAWER }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 6 }, { pid: ONION, spot: DRAWER, qty: 4 }],
  });
  const t = totals(s);
  expect(t.skipped.size).toBe(0);
  expect(t.qty[ONION]).toBe(10);
});

test('a spot counted AFTER being skipped keeps its number — a stale status never discards work', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }, { pid: ONION, spot: DRAWER }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 6 }, { pid: ONION, spot: DRAWER, qty: 4 }],
    skips: [DRAWER],   // status left behind; the count at that spot is the truth
  });
  const t = totals(s);
  expect(t.skipped.has(ONION)).toBe(false);
  expect(t.qty[ONION]).toBe(10);
});

test('a skip somewhere the product does not live does not affect it', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 6 }],
    skips: [DRAWER],
  });
  const t = totals(s);
  expect(t.skipped.size).toBe(0);
  expect(t.qty[ONION]).toBe(6);
});

test('out of stock is a REAL zero and still counts — only a skip is a gap', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }, { pid: ONION, spot: DRAWER }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 6 }, { pid: ONION, spot: DRAWER, qty: 0 }],
  });
  const t = totals(s);
  expect(t.skipped.size, '"I looked, there is none" is not a gap').toBe(0);
  expect(t.qty[ONION]).toBe(6);
});

test('couldn’t-find-it still wins its own gap, unchanged', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 0, notFound: true }],
  });
  const t = totals(s);
  expect(t.unknown.has(ONION)).toBe(true);
  expect(ONION in t.qty).toBe(false);
});

test('a session with no skips at all behaves exactly as before', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 7.5 }],
  });
  const t = totals(s);
  expect(t.qty[ONION]).toBe(7.5);
  expect(t.skipped.size).toBe(0);
  expect(t.unknown.size).toBe(0);
});

test('LEGACY: a count frozen flat at spot 0 with a real shelf skipped gives NO numbers', () => {
  // Legacy counts predate snapshots and were frozen at the catch-all spot 0, so
  // nothing says which shelf a product was on. A real shelf was skipped, so any
  // product could be the one that was missed — fail closed rather than hand back
  // partial sums as if they were totals.
  const s = makeSession({
    lines: [{ pid: ONION, spot: 0 }],
    entries: [{ pid: ONION, spot: 0, qty: 6 }],
    skips: [DRAWER],
  });
  const t = totals(s);
  expect(t.unverifiableSkip, 'the count cannot explain its own skip').toBe(true);
  expect(ONION in t.qty, 'no total may be trusted from it').toBe(false);
});

test('a MODERN count is never failed closed by a skip at a shelf it has lines for', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }, { pid: ONION, spot: DRAWER }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 6 }, { pid: ONION, spot: DRAWER, qty: 1 }],
    skips: [WALKIN],
  });
  const t = totals(s);
  expect(t.unverifiableSkip).toBe(false);
  expect(t.qty[ONION]).toBe(7);
});

test('the skipped shelf is NAMED, so the report can say where to go back to', () => {
  const s = makeSession({
    lines: [{ pid: ONION, spot: WALKIN }, { pid: ONION, spot: DRAWER }],
    entries: [{ pid: ONION, spot: WALKIN, qty: 6 }],
    skips: [DRAWER],
  });
  expect(totals(s).skippedSpotNames).toContain('D4');
});

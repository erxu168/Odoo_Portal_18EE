import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Two warnings, both earned on 3 August 2026.
 *
 * Ethan made a "Weekly Stock Check" at 13:32, mid-service, while the Daily count
 * was already under way. It could not join a walk (there wasn't one), so it
 * became a SECOND card — and it shared 7 products with the daily list. By
 * evening one shelf held two different answers for the same thyme: 0.03 on one
 * list, 0.0 on the other.
 *
 * His model: the daily list is produce and perishables, the weekly list is
 * packaging, sauces and slow movers. Overlap is an accident. When two lists do
 * want the same product, the daily one counts it.
 *
 * 1. templatesClashingProducts — tell him BEFORE he saves.
 * 2. ensureTodaySessionForTemplate — when a count is already running that covers
 *    these products, say so plainly instead of reporting "not scheduled today".
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-clash-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');
process.env.INVENTORY_MERGED_WALK = 'on';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const db = require('../src/lib/inventory-db');

// Deliberately far from other spec files' ranges: unit specs can share ONE
// worker process, and the first PORTAL_DB_PATH set at import time wins — so two
// files using the same company ids would count each other's lists.
const LOC = 4460;
let co = 4900;
let n = 0;

function makeList(opts: { companyId: number; productIds: number[]; frequency?: string; name?: string }): number {
  return db.createTemplate({
    name: opts.name || `List ${++n}`,
    frequency: opts.frequency || 'daily',
    schedule_days: [],
    adhoc_date: null,
    location_id: LOC,
    company_id: opts.companyId,
    category_ids: [],
    product_ids: opts.productIds,
    assign_type: null,
    assign_id: null,
    created_by: 1,
  });
}

test.beforeAll(() => { db.initInventoryTables(); });

test('a product already on another list of the SAME restaurant is reported', () => {
  const c = ++co;
  const daily = makeList({ companyId: c, productIds: [11, 12, 13], name: 'Daily Produce' });
  const clash = db.templatesClashingProducts(c, [12, 13, 99]);
  expect(clash.map((r: any) => r.product_id).sort()).toEqual([12, 13]);
  expect(clash.every((r: any) => r.template_id === daily)).toBe(true);
  expect(clash[0].template_name).toBe('Daily Produce');
});

test('another restaurant’s list is NEVER reported as a clash', () => {
  const mine = ++co;
  const theirs = ++co;
  makeList({ companyId: theirs, productIds: [21, 22] });
  expect(db.templatesClashingProducts(mine, [21, 22])).toEqual([]);
});

test('a list does not clash with ITSELF when edited', () => {
  const c = ++co;
  const id = makeList({ companyId: c, productIds: [31, 32] });
  expect(db.templatesClashingProducts(c, [31, 32], { excludeTemplateId: id })).toEqual([]);
  // …but still clashes with a sibling
  makeList({ companyId: c, productIds: [32] });
  const clash = db.templatesClashingProducts(c, [31, 32], { excludeTemplateId: id });
  expect(clash.map((r: any) => r.product_id)).toEqual([32]);
});

test('a DEACTIVATED list is not a clash — it counts nothing', () => {
  const c = ++co;
  const old = makeList({ companyId: c, productIds: [41] });
  db.updateTemplate(old, { active: false });
  expect(db.templatesClashingProducts(c, [41])).toEqual([]);
});

test('no products, or no restaurant, means nothing to warn about', () => {
  const c = ++co;
  makeList({ companyId: c, productIds: [51] });
  expect(db.templatesClashingProducts(c, [])).toEqual([]);
  expect(db.templatesClashingProducts(null, [51])).toEqual([]);
});

test('THE 13:32 CASE: a new list beside a count ALREADY BEING COUNTED defers, and says which products', () => {
  const c = ++co;
  // The daily count exists AND staff have started it — which is what made
  // 3 August unfixable. (An untouched day merges instead; see the test below.)
  const daily = makeList({ companyId: c, productIds: [61, 62], name: 'Daily' });
  db.generateTodaySessions([c]);
  const open = db.listSessions({ company_ids: [c], scheduled_date: db.todayStr() });
  expect(open, 'the daily count exists').toHaveLength(1);
  db.upsertCountEntry({ session_id: open[0].id, product_id: 61, count_location_id: 0, counted_qty: 2, uom: 'kg', counted_by: 1 });

  // Now a weekly list is created mid-service sharing one product.
  const weekly = makeList({ companyId: c, productIds: [62, 63], name: 'Weekly', frequency: 'daily' });
  const gen = db.ensureTodaySessionForTemplate(weekly);

  expect(gen.deferred, 'it must not open a second count over the same product').toBe(true);
  expect(gen.sessionId).toBeNull();
  expect(gen.clash, 'and it must name the product that clashed').toEqual([62]);

  // THE invariant: no product in two open counts today.
  const seen = new Map<number, number>();
  for (const s of db.listSessions({ company_ids: [c], scheduled_date: db.todayStr() })) {
    for (const i of db.getSessionItems(s.id)) {
      expect(seen.get(i.odoo_product_id), `product ${i.odoo_product_id} counted twice`).toBeUndefined();
      seen.set(i.odoo_product_id, s.id);
    }
  }
  expect(daily).toBeTruthy();
});

test('a list sharing NOTHING with the running count still gets its own count today', () => {
  const c = ++co;
  makeList({ companyId: c, productIds: [71, 72] });
  db.generateTodaySessions([c]);

  const other = makeList({ companyId: c, productIds: [81, 82] });
  const gen = db.ensureTodaySessionForTemplate(other);
  expect(gen.deferred, 'disjoint lists are safe and must not be blocked').toBe(false);
  expect(gen.sessionId).toBeTruthy();
});

test('the warning does NOT vanish when the merged walk is switched off', () => {
  // productsAlreadyCountedToday is the merge's own guard and returns nothing
  // with the flag off. A warning shown to a manager must not disappear with a
  // feature flag, so openCountClashToday always answers. (Codex, 2026-08-03.)
  const c = ++co;
  makeList({ companyId: c, productIds: [91, 92] });
  db.generateTodaySessions([c]);
  const prev = process.env.INVENTORY_MERGED_WALK;
  process.env.INVENTORY_MERGED_WALK = '';
  try {
    expect(db.productsAlreadyCountedToday(c, [92]), 'the merge guard is off').toEqual([]);
    expect(db.openCountClashToday(c, [92]), 'the warning still answers').toEqual([92]);
  } finally {
    process.env.INVENTORY_MERGED_WALK = prev;
  }
});

test('a repeated create for the SAME list returns its count, and never "clashes with itself"', () => {
  const c = ++co;
  const only = makeList({ companyId: c, productIds: [101, 102] });
  const first = db.ensureTodaySessionForTemplate(only);
  expect(first.sessionId).toBeTruthy();
  const again = db.ensureTodaySessionForTemplate(only);
  expect(again.deferred, 'idempotent — its own session is not a clash').toBe(false);
  expect(again.sessionId).toBe(first.sessionId);
});

test('a clash on an UNTOUCHED day is MERGED, not deferred — the good outcome first', () => {
  // Nobody has counted anything, so the whole day can be rebuilt as one walk
  // covering both lists. Deferring here would have been a wasted opportunity
  // and exactly what Ethan is trying to avoid. (Codex, 2026-08-03.)
  const c = ++co;
  makeList({ companyId: c, productIds: [111, 112], name: 'Daily' });
  db.generateTodaySessions([c]);

  const weekly = makeList({ companyId: c, productIds: [112, 113], name: 'Weekly' });
  const gen = db.ensureTodaySessionForTemplate(weekly);

  expect(gen.deferred, 'an untouched day merges instead of deferring').toBe(false);
  expect(gen.joinedWalk).toBe(true);

  const open = db.listSessions({ company_ids: [c], scheduled_date: db.todayStr() })
    .filter((s: any) => s.status === 'pending' || s.status === 'in_progress');
  expect(open, 'ONE list, not two').toHaveLength(1);
  const products = db.getSessionItems(open[0].id).map((i: any) => i.odoo_product_id).sort();
  expect(products, 'the union, each product once').toEqual([111, 112, 113]);
});

test('a clash on a day somebody has ALREADY counted still defers', () => {
  const c = ++co;
  const daily = makeList({ companyId: c, productIds: [121, 122], name: 'Daily' });
  db.generateTodaySessions([c]);
  const s = db.listSessions({ company_ids: [c], scheduled_date: db.todayStr() })[0];
  // Somebody counted something — the day must keep its shape.
  db.upsertCountEntry({ session_id: s.id, product_id: 121, count_location_id: 0, counted_qty: 3, uom: 'kg', counted_by: 1 });

  const weekly = makeList({ companyId: c, productIds: [122, 123], name: 'Weekly' });
  const gen = db.ensureTodaySessionForTemplate(weekly);
  expect(gen.deferred, 'work has started — do not rearrange the day').toBe(true);
  expect(gen.clash).toEqual([122]);
  expect(daily).toBeTruthy();
});

test('an OPENED count with no numbers in it yet is still safe from being rearranged', () => {
  // in_progress means somebody has the list open on a tablet. Reconciliation
  // only ever replaces a PENDING session with no work in it, so opening a count
  // is itself protection. (Codex asked for this guarantee to be pinned.)
  const c = ++co;
  makeList({ companyId: c, productIds: [131, 132], name: 'Daily' });
  db.generateTodaySessions([c]);
  const s = db.listSessions({ company_ids: [c], scheduled_date: db.todayStr() })[0];
  db.updateSessionStatus(s.id, 'in_progress');

  const weekly = makeList({ companyId: c, productIds: [132, 133], name: 'Weekly' });
  const gen = db.ensureTodaySessionForTemplate(weekly);

  expect(gen.deferred, 'an open count is not rearranged under the person holding it').toBe(true);
  const after = db.listSessions({ company_ids: [c], scheduled_date: db.todayStr() });
  expect(after.some((x: any) => x.id === s.id), 'the opened count still exists').toBe(true);
});

test('a list that already HAS today’s count gets it back, even when another count clashes', () => {
  const c = ++co;
  const mine = makeList({ companyId: c, productIds: [141], name: 'Mine' });
  db.generateTodaySessions([c]);
  const own = db.listSessions({ company_ids: [c], scheduled_date: db.todayStr() })[0];
  db.updateSessionStatus(own.id, 'in_progress');
  // A second, overlapping open count exists (allowed duplicates, or legacy data).
  const other = makeList({ companyId: c, productIds: [141], name: 'Other' });
  db.createSession({ template_id: other, scheduled_date: db.todayStr(), location_id: LOC, company_id: c, assigned_user_id: null });

  const gen = db.ensureTodaySessionForTemplate(mine);
  expect(gen.sessionId, 'its own count must never be hidden by someone else’s clash').toBe(own.id);
  expect(gen.deferred).toBe(false);
});

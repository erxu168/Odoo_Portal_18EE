import { test, expect } from '@playwright/test';
import fs from 'fs'; import os from 'os'; import path from 'path';

/**
 * MERGED DAILY WALK — the rules that protect the count ledger.
 *
 * The whole feature exists to stop staff walking one location twice, but the
 * thing that must NEVER happen is the opposite mistake: one product sitting in
 * two open counts on the same day, so approval writes that product's stock
 * twice and the second write silently wins.
 *
 * These tests are the guard rail for that. They run against a real SQLite file
 * with the flag ON, because with it off the merge does nothing at all.
 */
process.env.INVENTORY_MERGED_WALK = 'on';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-walk-'));
process.env.PORTAL_DB_PATH = path.join(dir, 'portal.db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../src/lib/inventory-db');

const CO = 900;                       // a restaurant of our own
const LOC = 77;                       // its Odoo stock location
let seq = 0;
const nextName = (p: string) => `${p}-${++seq}`;

function makeList(opts: {
  frequency: 'daily' | 'weekly' | 'monthly' | 'adhoc';
  productIds?: number[];
  categoryIds?: number[];
  scheduleDays?: number[];
  adhocDate?: string | null;
  companyId?: number;
  locationId?: number;
}): number {
  return db.createTemplate({
    name: nextName(opts.frequency),
    frequency: opts.frequency,
    schedule_days: opts.scheduleDays ?? [],
    adhoc_date: opts.adhocDate ?? null,
    location_id: opts.locationId ?? LOC,
    company_id: opts.companyId ?? CO,
    category_ids: opts.categoryIds ?? [],
    product_ids: opts.productIds ?? [],
    assign_type: null,
    assign_id: null,
    created_by: 1,
  });
}

/** Today's OPEN sessions for our restaurant, with their frozen product ids. */
function openSessionsToday(companyId = CO) {
  const today = db.todayStr();
  return db.listSessions({ company_ids: [companyId], scheduled_date: today })
    .filter((s: any) => s.status === 'pending' || s.status === 'in_progress')
    .map((s: any) => ({
      id: s.id,
      products: db.getSessionItems(s.id).map((i: any) => i.odoo_product_id).sort((a: number, b: number) => a - b),
      sources: JSON.parse(s.source_templates_json || '[]').map((x: any) => x.template_id).sort((a: number, b: number) => a - b),
    }));
}

/** THE invariant: no product may appear in two open counts on the same day. */
function assertNoProductCountedTwice(companyId = CO) {
  const seen = new Map<number, number>();
  for (const s of openSessionsToday(companyId)) {
    for (const pid of s.products) {
      const other = seen.get(pid);
      expect(other, `product ${pid} is in sessions ${other} AND ${s.id}`).toBeUndefined();
      seen.set(pid, s.id);
    }
  }
}

test.beforeAll(() => { process.env.INVENTORY_MERGED_WALK = 'on'; db.initInventoryTables(); });

test('two due lists become ONE walk that covers both, each product once', () => {
  const co = CO + 1;
  const daily = makeList({ frequency: 'daily', productIds: [11, 12], companyId: co });
  const weekly = makeList({ frequency: 'daily', productIds: [12, 13], companyId: co });   // 12 overlaps on purpose

  db.generateTodaySessions([co]);

  const open = openSessionsToday(co);
  expect(open, 'one combined walk, not two lists').toHaveLength(1);
  expect(open[0].products, 'the union, deduped — 12 appears once').toEqual([11, 12, 13]);
  expect(open[0].sources).toEqual([daily, weekly].sort((a, b) => a - b));
  assertNoProductCountedTwice(co);
});

test('a single due list is left exactly as it was — no walk', () => {
  const co = CO + 2;
  makeList({ frequency: 'daily', productIds: [21, 22], companyId: co });

  db.generateTodaySessions([co]);

  const open = openSessionsToday(co);
  expect(open).toHaveLength(1);
  expect(open[0].sources, 'not a merged walk').toEqual([]);
  expect(open[0].products).toEqual([21, 22]);
});

test('generating twice does not create a second count', () => {
  const co = CO + 3;
  makeList({ frequency: 'daily', productIds: [31], companyId: co });
  makeList({ frequency: 'daily', productIds: [32], companyId: co });

  db.generateTodaySessions([co]);
  db.generateTodaySessions([co]);
  db.generateTodaySessions([co]);

  expect(openSessionsToday(co)).toHaveLength(1);
  assertNoProductCountedTwice(co);
});

test('a CATEGORY list (unknown contents) blocks merging — everything stays per-list', () => {
  const co = CO + 4;
  makeList({ frequency: 'daily', productIds: [41, 42], companyId: co });
  makeList({ frequency: 'daily', productIds: [43], companyId: co });
  makeList({ frequency: 'daily', categoryIds: [5], companyId: co });   // no product_ids = unknown

  db.generateTodaySessions([co]);

  const open = openSessionsToday(co);
  expect(open.every((s: any) => s.sources.length === 0), 'no walk while contents are unknown').toBe(true);
  assertNoProductCountedTwice(co);
});

test('once counting has started, the day is NOT rearranged', () => {
  const co = CO + 5;
  const a = makeList({ frequency: 'daily', productIds: [51], companyId: co });
  db.generateTodaySessions([co]);            // one list → its own session
  const first = openSessionsToday(co)[0];

  // Somebody counts something in it.
  db.upsertCountEntry({
    session_id: first.id, product_id: 51, count_location_id: 0,
    counted_qty: 3, uom: 'Units', counted_by: 1,
  });

  // A second list becomes due later the same day.
  makeList({ frequency: 'daily', productIds: [52], companyId: co });
  db.generateTodaySessions([co]);

  const open = openSessionsToday(co);
  expect(open.find((s: any) => s.id === first.id), 'the started count survives untouched').toBeTruthy();
  expect(open.every((s: any) => s.sources.length === 0), 'no walk swallowed the started count').toBe(true);
  assertNoProductCountedTwice(co);
  expect(a).toBeTruthy();
});

test('a list added mid-day joins the walk while nobody has counted yet', () => {
  const co = CO + 6;
  makeList({ frequency: 'daily', productIds: [61], companyId: co });
  makeList({ frequency: 'daily', productIds: [62], companyId: co });
  db.generateTodaySessions([co]);
  expect(openSessionsToday(co)).toHaveLength(1);

  const late = makeList({ frequency: 'daily', productIds: [63], companyId: co });
  db.generateTodaySessions([co]);

  const open = openSessionsToday(co);
  expect(open, 'still exactly one walk').toHaveLength(1);
  expect(open[0].products).toEqual([61, 62, 63]);
  expect(open[0].sources).toContain(late);
  assertNoProductCountedTwice(co);
});

test('when every source stops being due, an untouched walk is cleared away', () => {
  const co = CO + 7;
  const a = makeList({ frequency: 'daily', productIds: [71], companyId: co });
  const b = makeList({ frequency: 'daily', productIds: [72], companyId: co });
  db.generateTodaySessions([co]);
  expect(openSessionsToday(co)).toHaveLength(1);

  db.updateTemplate(a, { active: false });
  db.updateTemplate(b, { active: false });
  db.generateTodaySessions([co]);

  expect(openSessionsToday(co), 'no stale walk asking for products nobody counts').toHaveLength(0);
});

test('when the group shrinks to one list, the walk becomes that list’s own count', () => {
  const co = CO + 8;
  const a = makeList({ frequency: 'daily', productIds: [81], companyId: co });
  const b = makeList({ frequency: 'daily', productIds: [82], companyId: co });
  db.generateTodaySessions([co]);
  expect(openSessionsToday(co)[0].sources).toHaveLength(2);

  db.updateTemplate(b, { active: false });
  db.generateTodaySessions([co]);

  const open = openSessionsToday(co);
  expect(open).toHaveLength(1);
  expect(open[0].sources, 'dissolved back to a plain count').toEqual([]);
  expect(open[0].products).toEqual([81]);
  expect(a).toBeTruthy();
});

test('a manual count cannot be created for products the walk already covers', () => {
  const co = CO + 9;
  makeList({ frequency: 'daily', productIds: [91], companyId: co });
  makeList({ frequency: 'daily', productIds: [92], companyId: co });
  db.generateTodaySessions([co]);

  const clashing = makeList({ frequency: 'adhoc', productIds: [92], companyId: co, adhocDate: db.todayStr() });
  const outcome = db.createSessionGuarded({
    template_id: clashing, scheduled_date: db.todayStr(),
    location_id: LOC, company_id: co, product_ids: [92],
  });

  expect(outcome.id, 'refused').toBeNull();
  expect(outcome.clash).toEqual([92]);
  assertNoProductCountedTwice(co);
});

test('a rejected count cannot be reopened while its products are in another open count', () => {
  const co = CO + 10;
  const a = makeList({ frequency: 'daily', productIds: [101], companyId: co });
  db.generateTodaySessions([co]);
  const first = openSessionsToday(co)[0];

  db.updateSessionStatus(first.id, 'submitted');
  db.updateSessionStatus(first.id, 'rejected');

  // With it out of the way, another count picks the product up.
  makeList({ frequency: 'daily', productIds: [101, 102], companyId: co });
  db.generateTodaySessions([co]);

  const reopened = db.reopenRejectedSessionGuarded(first.id);
  expect(reopened.result, 'refused — 101 is already being counted').toBe('clash');
  expect(reopened.clash).toEqual([101]);
  assertNoProductCountedTwice(co);
  expect(a).toBeTruthy();
});

test('a SUBMITTED count does not block a fresh one (Ethan: allow it)', () => {
  const co = CO + 11;
  makeList({ frequency: 'daily', productIds: [111], companyId: co });
  db.generateTodaySessions([co]);
  const first = openSessionsToday(co)[0];
  db.updateSessionStatus(first.id, 'submitted');

  const other = makeList({ frequency: 'adhoc', productIds: [111], companyId: co, adhocDate: db.todayStr() });
  const outcome = db.createSessionGuarded({
    template_id: other, scheduled_date: db.todayStr(),
    location_id: LOC, company_id: co, product_ids: [111],
  });
  expect(outcome.id, 'allowed — the submitted one is off the floor').not.toBeNull();
});

test('lists in different Odoo locations are never merged', () => {
  const co = CO + 12;
  makeList({ frequency: 'daily', productIds: [121], companyId: co, locationId: 1 });
  makeList({ frequency: 'daily', productIds: [122], companyId: co, locationId: 2 });

  db.generateTodaySessions([co]);

  const open = openSessionsToday(co);
  expect(open, 'two counts, because they write to two different stock locations').toHaveLength(2);
  expect(open.every((s: any) => s.sources.length === 0)).toBe(true);
  assertNoProductCountedTwice(co);
});

test('monthly lists fire on their day, and a 31st list fires on a short month’s last day', () => {
  const shouldFire = (dom: number, on: string) => {
    const [y, m, d] = on.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d === Math.min(dom, daysInMonth);
  };
  expect(shouldFire(1, '2026-03-01')).toBe(true);
  expect(shouldFire(1, '2026-03-02')).toBe(false);
  expect(shouldFire(31, '2026-02-28'), 'February: the 31st means the 28th').toBe(true);
  expect(shouldFire(31, '2026-03-31')).toBe(true);
  expect(shouldFire(31, '2026-04-30'), 'April has 30 days').toBe(true);
});

import { test, expect } from '@playwright/test';
import fs from 'fs'; import os from 'os'; import path from 'path';

/**
 * WALKABLE GROUPS — which of today's counts may share ONE route.
 *
 * Nothing is merged in the database; this only decides what staff walk
 * together. The rule that makes it safe: no product may appear in two counts of
 * a group, so every line has exactly one owning count and each number is
 * written exactly where it would have been anyway.
 *
 * Runs in the SHIPPING configuration (the database-level merge stays off), so
 * separate lists really do produce separate counts to group.
 */
process.env.INVENTORY_MERGED_WALK = 'off';   // the shipping configuration
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-groups-'));
process.env.PORTAL_DB_PATH = path.join(dir, 'portal.db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../src/lib/inventory-db');

const CO = 700;
const LOC = 55;
let seq = 0;

function makeList(opts: { productIds?: number[]; categoryIds?: number[]; companyId?: number; locationId?: number }): number {
  return db.createTemplate({
    name: `list-${++seq}`,
    frequency: 'daily',
    schedule_days: [],
    adhoc_date: null,
    location_id: opts.locationId ?? LOC,
    company_id: opts.companyId ?? CO,
    category_ids: opts.categoryIds ?? [],
    product_ids: opts.productIds ?? [],
    assign_type: null,
    assign_id: null,
    created_by: 1,
  });
}

function openIdsToday(companyId: number): number[] {
  return db.listSessions({ company_ids: [companyId], scheduled_date: db.todayStr() })
    .filter((s: any) => s.status === 'pending' || s.status === 'in_progress')
    .map((s: any) => s.id);
}

test.beforeAll(() => { process.env.INVENTORY_MERGED_WALK = 'off'; db.initInventoryTables(); });
test('two counts with different products in the same restaurant walk together', () => {
  const co = CO + 20;
  makeList({ productIds: [201, 202], companyId: co });
  makeList({ productIds: [203], companyId: co });
  db.generateTodaySessions([co]);
  const open = openIdsToday(co);
  const groups = db.walkableGroupsToday(open);
  expect(groups, 'one walk covering both counts').toHaveLength(1);
  expect(groups[0].sort()).toEqual(open.sort());
});

test('counts that SHARE a product are never walked together', () => {
  // Generation can no longer PRODUCE this overlap — a product is frozen into
  // only one of today's counts. But counts created before that rule existed are
  // sitting in the live database right now, so the grouping guard still has to
  // hold. Build that legacy state directly and check it.
  const co = CO + 21;
  makeList({ productIds: [211, 212], companyId: co });
  makeList({ productIds: [213], companyId: co });
  db.generateTodaySessions([co]);
  const open = openIdsToday(co);
  expect(open).toHaveLength(2);
  const second = open[1];
  db.snapshotSessionItems(second, [
    { odoo_product_id: 213, count_location_id: 0, shelf_sort: 0 },
    { odoo_product_id: 212, count_location_id: 0, shelf_sort: 1 },   // legacy duplicate
  ]);

  const groups = db.walkableGroupsToday(open);
  expect(groups, 'kept apart — a shared product must have ONE owner').toHaveLength(2);
  expect(groups.every((g: number[]) => g.length === 1)).toBe(true);
});

test('counts in different restaurants are never walked together', () => {
  const coA = CO + 22, coB = CO + 23;
  makeList({ productIds: [221], companyId: coA });
  makeList({ productIds: [222], companyId: coB });
  db.generateTodaySessions([coA]); db.generateTodaySessions([coB]);
  const ids = [...openIdsToday(coA), ...openIdsToday(coB)];
  const groups = db.walkableGroupsToday(ids);
  expect(groups).toHaveLength(2);
});

test('counts writing to different stock locations are never walked together', () => {
  const co = CO + 24;
  makeList({ productIds: [241], companyId: co, locationId: 11 });
  makeList({ productIds: [242], companyId: co, locationId: 12 });
  db.generateTodaySessions([co]);
  const groups = db.walkableGroupsToday(openIdsToday(co));
  expect(groups).toHaveLength(2);
});

test('a category count (contents unknown) always walks alone', () => {
  const co = CO + 25;
  makeList({ productIds: [251], companyId: co });
  makeList({ categoryIds: [7], companyId: co });   // no frozen lines
  db.generateTodaySessions([co]);
  const groups = db.walkableGroupsToday(openIdsToday(co));
  expect(groups.every((g: number[]) => g.length === 1), 'unknown contents can’t be reasoned about').toBe(true);
});

test('a single count returns a single group — nothing changes for one list', () => {
  const co = CO + 26;
  makeList({ productIds: [261], companyId: co });
  db.generateTodaySessions([co]);
  const ids = openIdsToday(co);
  expect(db.walkableGroupsToday(ids)).toEqual([ids]);
});

test('the SAME product at different spots still keeps counts apart', () => {
  // Approval writes one quantity per product per Odoo location, so two counts
  // holding the same product collide there even when the portal spots differ.
  const co = CO + 30;
  const a = makeList({ productIds: [301], companyId: co });
  const b = makeList({ productIds: [301], companyId: co });
  db.generateTodaySessions([co]);
  const groups = db.walkableGroupsToday(openIdsToday(co));
  expect(groups.every((g: number[]) => g.length === 1), 'never walked together').toBe(true);
  expect(a && b).toBeTruthy();
});

/**
 * ONE PRODUCT, ONE COUNT PER DAY — enforced where the lines are frozen.
 *
 * A weekly deep-count repeats staples the daily list covers. The duplicate is
 * never created: the daily keeps them, the weekly gives them up. Downstream
 * (walk, submit, approval, reports) then sees an ordinary count with nothing
 * special about it — which is the whole point of doing it here.
 */
function productsOf(sessionId: number): number[] {
  return Array.from(new Set(db.getSessionItems(sessionId).map((i: any) => i.odoo_product_id))).sort((a: any, b: any) => a - b);
}

test('the DAILY list keeps a shared staple; the weekly simply does not carry it', () => {
  const co = CO + 50;
  const daily = db.createTemplate({
    name: 'D-50', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [501, 502],
    assign_type: null, assign_id: null, created_by: 1,
  });
  const weekly = db.createTemplate({
    name: 'W-50', frequency: 'weekly', schedule_days: [0,1,2,3,4,5,6], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [502, 503],  // 502 shared
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([co]);

  const dailyId = db.listSessions({ company_ids: [co], template_id: daily })[0].id;
  const weeklyId = db.listSessions({ company_ids: [co], template_id: weekly })[0].id;

  expect(productsOf(dailyId), 'the daily is untouched').toEqual([501, 502]);
  expect(productsOf(weeklyId), 'the weekly gave up the shared staple').toEqual([503]);

  // THE invariant, stated directly: no product is in two of today's counts.
  const all = [...productsOf(dailyId), ...productsOf(weeklyId)];
  expect(new Set(all).size, 'every product appears exactly once today').toBe(all.length);
});

test('the daily keeps them however the lists were created', () => {
  // Weekly created FIRST — generation still freezes the daily first.
  const co = CO + 51;
  const weekly = db.createTemplate({
    name: 'W-51', frequency: 'weekly', schedule_days: [0,1,2,3,4,5,6], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [511, 512],
    assign_type: null, assign_id: null, created_by: 1,
  });
  const daily = db.createTemplate({
    name: 'D-51', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [511],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([co]);
  const dailyId = db.listSessions({ company_ids: [co], template_id: daily })[0].id;
  const weeklyId = db.listSessions({ company_ids: [co], template_id: weekly })[0].id;
  expect(productsOf(dailyId), 'daily keeps the staple').toEqual([511]);
  expect(productsOf(weeklyId), 'weekly keeps only what is its own').toEqual([512]);
});

test('a different stock location keeps its own copy — each location needs a number', () => {
  const co = CO + 52;
  const a = db.createTemplate({
    name: 'A-52', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: 81, company_id: co, category_ids: [], product_ids: [521],
    assign_type: null, assign_id: null, created_by: 1,
  });
  const b = db.createTemplate({
    name: 'B-52', frequency: 'weekly', schedule_days: [0,1,2,3,4,5,6], adhoc_date: null,
    location_id: 82, company_id: co, category_ids: [], product_ids: [521],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([co]);
  const aId = db.listSessions({ company_ids: [co], template_id: a })[0].id;
  const bId = db.listSessions({ company_ids: [co], template_id: b })[0].id;
  expect(productsOf(aId)).toEqual([521]);
  expect(productsOf(bId), 'a separate stock location still gets counted').toEqual([521]);
});

test('another restaurant is never affected', () => {
  const coA = CO + 53, coB = CO + 54;
  const a = db.createTemplate({
    name: 'A-53', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: coA, category_ids: [], product_ids: [531],
    assign_type: null, assign_id: null, created_by: 1,
  });
  const b = db.createTemplate({
    name: 'B-53', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: coB, category_ids: [], product_ids: [531],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([coA]); db.generateTodaySessions([coB]);
  expect(productsOf(db.listSessions({ company_ids: [coA], template_id: a })[0].id)).toEqual([531]);
  expect(productsOf(db.listSessions({ company_ids: [coB], template_id: b })[0].id), 'each restaurant counts its own').toEqual([531]);
});

test('one list on its own is completely unaffected', () => {
  const co = CO + 55;
  const only = db.createTemplate({
    name: 'D-55', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [551, 552, 553],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([co]);
  expect(productsOf(db.listSessions({ company_ids: [co], template_id: only })[0].id)).toEqual([551, 552, 553]);
});

test('after the exclusion the two lists can share ONE walk', () => {
  const co = CO + 56;
  db.createTemplate({
    name: 'D-56', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [561, 562],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.createTemplate({
    name: 'W-56', frequency: 'weekly', schedule_days: [0,1,2,3,4,5,6], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [562, 563],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([co]);
  const groups = db.walkableGroupsToday(openIdsToday(co));
  expect(groups, 'one walk covering both counts').toHaveLength(1);
  expect(groups[0]).toHaveLength(2);
});

/**
 * These run in the SHIPPING configuration (merged walk OFF), which is exactly
 * where the first version of this rule did nothing at all: overlap sent the
 * whole list away instead of dropping the shared products. (Codex, 2026-08-04.)
 */
test('with the merged walk OFF, a list made beside a running count still counts its own products today', () => {
  const co = CO + 60;
  const daily = db.createTemplate({
    name: 'D-60', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [601, 602],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([co]);
  const dailyId = db.listSessions({ company_ids: [co], template_id: daily })[0].id;
  db.updateSessionStatus(dailyId, 'in_progress');   // staff are walking it

  // Mid-service, a manager makes a list sharing one product.
  const weekly = db.createTemplate({
    name: 'W-60', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [602, 603],
    assign_type: null, assign_id: null, created_by: 1,
  });
  const gen = db.ensureTodaySessionForTemplate(weekly);

  expect(gen.deferred, 'it counts today — it is not sent away').toBe(false);
  expect(productsOf(gen.sessionId), 'only what nobody is holding').toEqual([603]);
  expect(productsOf(dailyId), 'the running count is untouched').toEqual([601, 602]);
});

test('a list with nothing of its own left opens NO count at all — never an empty one', () => {
  const co = CO + 61;
  db.createTemplate({
    name: 'D-61', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [611, 612],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([co]);

  const sub = db.createTemplate({
    name: 'S-61', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [611],
    assign_type: null, assign_id: null, created_by: 1,
  });
  const gen = db.ensureTodaySessionForTemplate(sub);
  expect(gen.sessionId, 'nothing to count means no count').toBeNull();
  expect(gen.deferred).toBe(true);
  expect(db.listSessions({ company_ids: [co], template_id: sub }), 'and no empty session was left behind').toHaveLength(0);
});

test('an empty count is refused even when the check was stale — the freeze itself decides', () => {
  // The precheck reads the template, then createSession re-reads it to freeze.
  // Between the two, everything this list wanted can already be taken. The
  // transaction rolls back rather than leave an empty snapshot, which
  // downstream would read as a legacy count and re-count the whole template.
  const co = CO + 62;
  db.createTemplate({
    name: 'D-62', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [621],
    assign_type: null, assign_id: null, created_by: 1,
  });
  db.generateTodaySessions([co]);
  const other = db.createTemplate({
    name: 'O-62', frequency: 'daily', schedule_days: [], adhoc_date: null,
    location_id: LOC, company_id: co, category_ids: [], product_ids: [621],
    assign_type: null, assign_id: null, created_by: 1,
  });
  expect(() => db.createSession({
    template_id: other, scheduled_date: db.todayStr(), location_id: LOC, company_id: co, assigned_user_id: null,
  }), 'the raw creator refuses too').toThrow();
  expect(db.listSessions({ company_ids: [co], template_id: other })).toHaveLength(0);
});

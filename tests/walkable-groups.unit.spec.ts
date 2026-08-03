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
  const co = CO + 21;
  makeList({ productIds: [211, 212], companyId: co });
  makeList({ productIds: [212, 213], companyId: co });   // 212 in both
  db.generateTodaySessions([co]);
  const open = openIdsToday(co);
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

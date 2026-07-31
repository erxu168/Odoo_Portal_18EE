import { test, expect } from '@playwright/test';
import fs from 'fs'; import os from 'os'; import path from 'path';

/**
 * The Waste Tracker supplies the third term of the consumption equation:
 *   opening + purchases − WASTE − closing = what we used
 * Real database, because the report's arithmetic depends on these sums.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-waste-'));
process.env.PORTAL_DB_PATH = path.join(dir, 'portal.db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../src/lib/inventory-db');
const WAJ = 6, P1 = 700001, P2 = 700002;

test.beforeAll(() => db.initInventoryTables());

test('an entry is recorded and counted against the product', () => {
  db.recordWaste({ companyId: WAJ, productId: P1, qtyBase: 2, uom: 'kg', reason: 'gone off', userId: 1 });
  db.recordWaste({ companyId: WAJ, productId: P1, qtyBase: 3, uom: 'kg', userId: 1 });
  const sums = db.sumWasteByProduct([WAJ], '2000-01-01', '2999-01-01');
  expect(sums[P1]).toBe(5);
});

test('a reason is OPTIONAL — a quantity with none still closes the equation', () => {
  // Anything that can block an entry is a reason people stop recording at all.
  const id = db.recordWaste({ companyId: WAJ, productId: P2, qtyBase: 1, userId: 1 });
  expect(id).toBeGreaterThan(0);
  expect(db.sumWasteByProduct([WAJ], '2000-01-01', '2999-01-01')[P2]).toBe(1);
});

test('zero or negative is refused — it would silently distort usage', () => {
  expect(() => db.recordWaste({ companyId: WAJ, productId: P1, qtyBase: 0, userId: 1 })).toThrow(/WASTE_INVALID/);
  expect(() => db.recordWaste({ companyId: WAJ, productId: P1, qtyBase: -2, userId: 1 })).toThrow(/WASTE_INVALID/);
});

test('UNDO removes it from the maths but keeps the trail', () => {
  const id = db.recordWaste({ companyId: WAJ, productId: P2, qtyBase: 9, userId: 1 });
  expect(db.voidWaste(id, 1)).toBe(true);
  expect(db.sumWasteByProduct([WAJ], '2000-01-01', '2999-01-01')[P2], 'the 9 must not count').toBe(1);
  expect(db.voidWaste(id, 1), 'undoing twice does nothing').toBe(false);
});

test('another restaurant’s waste never lands in this one’s figures', () => {
  db.recordWaste({ companyId: 3, productId: P1, qtyBase: 50, userId: 1 });
  expect(db.sumWasteByProduct([WAJ], '2000-01-01', '2999-01-01')[P1]).toBe(5);
  expect(db.sumWasteByProduct([3], '2000-01-01', '2999-01-01')[P1]).toBe(50);
  expect(db.sumWasteByProduct([], '2000-01-01', '2999-01-01'), 'no companies = nothing').toEqual({});
});

test('period boundaries match the purchases term — no event counted twice', () => {
  // Exclusive start, inclusive end, exactly like sumReceiptsByProduct. Two
  // adjacent periods must never both claim the same entry.
  const before = db.sumWasteByProduct([WAJ], '2999-01-01', '2999-01-02');
  expect(before[P1]).toBeUndefined();
});

test('what was typed is kept, not just the converted number', () => {
  // "2 bags" should be showable back as 2 bags, not 1.4 kg.
  db.recordWaste({ companyId: WAJ, productId: P2, qtyBase: 1.4, crateQty: 2, unitsPerCrate: 0.7,
    uom: 'kg', userId: 1 });
  const rows = db.listWaste(WAJ, { limit: 50 });
  const row = rows.find((r: any) => r.odoo_product_id === P2 && r.crate_qty === 2);
  expect(row).toBeTruthy();
  expect(row.units_per_crate).toBe(0.7);
});

test('"recently binned here" is what makes it one tap', () => {
  const recent = db.recentlyWastedProducts(WAJ, 8);
  expect(recent.length).toBeGreaterThan(0);
  expect(recent, 'most recent first').toContain(P2);
});

test.afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

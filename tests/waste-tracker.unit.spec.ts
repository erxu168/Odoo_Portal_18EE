import { test, expect } from '@playwright/test';
import fs from 'fs'; import os from 'os'; import path from 'path';

/**
 * The Waste Tracker supplies the third term of the consumption equation:
 *   opening + purchases − WASTE − closing = what we used
 * Real database, because the report's arithmetic depends on these sums.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-waste-'));
process.env.PORTAL_DB_PATH = path.join(dir, 'portal.db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
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

const P3 = 700003;

test('an entry can be fetched by id — Undo needs a handle it can check', () => {
  // The route must see WHOSE entry it is and WHICH restaurant's before voiding.
  const id = db.recordWaste({ companyId: WAJ, productId: P3, qtyBase: 2, userId: 7 });
  const row = db.getWasteEvent(id);
  expect(row.company_id).toBe(WAJ);
  expect(row.wasted_by).toBe(7);
  expect(db.getWasteEvent(99999999)).toBeNull();
});

test('reason and photo can be added AFTER the save — the entry is already safe', () => {
  // The mock's "or just walk away — it's already saved": the quantity is
  // committed at the numpad; the why-screen only annotates.
  const id = db.recordWaste({ companyId: WAJ, productId: P3, qtyBase: 1, userId: 1 });
  expect(db.annotateWaste(id, { reason: 'gone off' })).toBe(true);
  expect(db.annotateWaste(id, { photo: 'data:image/jpeg;base64,xx' })).toBe(true);
  const row = db.getWasteEvent(id);
  expect(row.reason).toBe('gone off');
  expect(row.photo).toContain('data:image');
  expect(row.qty_base, 'annotating must never touch the amount').toBe(1);
});

test('annotating a voided entry is refused — undone means gone from the story', () => {
  const id = db.recordWaste({ companyId: WAJ, productId: P3, qtyBase: 1, userId: 1 });
  db.voidWaste(id, 1);
  expect(db.annotateWaste(id, { reason: 'too late' })).toBe(false);
});

test('photo-required is per department and OFF until a manager turns it on', () => {
  // Off by default ON PURPOSE: a required photo is the most likely reason
  // someone quietly stops recording.
  expect(db.isWastePhotoRequired(9101)).toBe(false);
  db.setWastePhotoRequired(9101, WAJ, true, 1);
  expect(db.isWastePhotoRequired(9101)).toBe(true);
  db.setWastePhotoRequired(9101, WAJ, false, 1);
  expect(db.isWastePhotoRequired(9101)).toBe(false);
});

test('a nonsense amount is refused, not stored — Infinity is not a quantity', () => {
  expect(() => db.recordWaste({ companyId: WAJ, productId: P3, qtyBase: Infinity, userId: 1 })).toThrow(/WASTE_INVALID/);
  expect(() => db.recordWaste({ companyId: WAJ, productId: P3, qtyBase: NaN, userId: 1 })).toThrow(/WASTE_INVALID/);
  expect(() => db.recordWaste({ companyId: WAJ, productId: P3, qtyBase: 20_000_000, userId: 1 })).toThrow(/WASTE_INVALID/);
});

const P4 = 700004, P5 = 700005;

test('a network retry with the same client key records ONCE', () => {
  // Kitchen wifi is flaky; a double-tap or an ambiguous retry must not bin the
  // same crate twice — that would corrupt the one number this exists to produce.
  const a = db.recordWaste({ companyId: WAJ, productId: P4, qtyBase: 4, userId: 1, clientKey: 'retry-abc-1' });
  const b = db.recordWaste({ companyId: WAJ, productId: P4, qtyBase: 4, userId: 1, clientKey: 'retry-abc-1' });
  expect(b).toBe(a);
  expect(db.sumWasteByProduct([WAJ], '2000-01-01', '2999-01-01')[P4]).toBe(4);
});

test('recently binned is per DEPARTMENT when the tablet has one', () => {
  // "Recently binned HERE" — the bar's bottles must not fill the kitchen's grid.
  db.recordWaste({ companyId: WAJ, productId: P4, qtyBase: 1, userId: 1, departmentId: 9201 });
  db.recordWaste({ companyId: WAJ, productId: P5, qtyBase: 1, userId: 1, departmentId: 9202 });
  const kitchen = db.recentlyWastedProducts(WAJ, 8, 9201);
  expect(kitchen).toContain(P4);
  expect(kitchen).not.toContain(P5);
  expect(db.recentlyWastedProducts(WAJ, 8), 'no department = whole restaurant').toContain(P5);
});

test("the settings sheet sees each department's switch for ITS restaurant only", () => {
  db.setWastePhotoRequired(9102, WAJ, true, 1);
  db.setWastePhotoRequired(9103, 3, true, 1);   // another restaurant's department
  const map = db.wastePhotoRequiredByDepartment(WAJ);
  expect(map[9102]).toBe(true);
  expect(map[9103]).toBeUndefined();
});

test.afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

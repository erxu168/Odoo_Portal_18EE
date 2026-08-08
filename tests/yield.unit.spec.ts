import { test, expect } from '@playwright/test';
import fs from 'fs'; import os from 'os'; import path from 'path';

/**
 * YIELD — the arithmetic behind "true cost", and the rules that stop it
 * corrupting the counting it feeds.
 *
 * Two of these tests exist because a review found the bug before a user did:
 *  - a kg base unit is NOT enough to make a pack size measurable ("Ketchup 10kg
 *    Eimer" is a real row in this catalogue);
 *  - a retried save on a phone must not become a second measurement.
 */

// 7900+ — every unit spec shares one worker and the FIRST PORTAL_DB_PATH wins,
// so company ids must not collide with another file's (merged-walk uses 900,
// location-label uses 4900).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-yield-'));
process.env.PORTAL_DB_PATH = process.env.PORTAL_DB_PATH || path.join(dir, 'portal.db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Y = require('../src/lib/yield');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../src/lib/inventory-db');
// The portal's own tables (portal_users) live in the same file and the yield
// query joins them for "who weighed it". Touching getDb() creates them — and
// this spec is the reason the join was found pointing at a `users` table that
// has never existed in this schema.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../src/lib/db').getDb();

const CO = 7901;
const CO_OTHER = 7902;

let nextId = 1;
/** A test, `days` ago, so the rolling window has an order to work with. */
function mk(raw: number, pieces: number | null, usable: number, days = 0) {
  const d = new Date(Date.UTC(2026, 0, 1 + (60 - days)));
  return {
    id: nextId++, odoo_product_id: 1, company_id: CO,
    raw_qty: raw, pieces, usable_qty: usable,
    note: null, created_at: d.toISOString(), created_by: 1,
  };
}

// ── the arithmetic ──

test('yield pools the totals rather than averaging the percentages', () => {
  // A 10 kg test at 50% and a 1 kg test at 100% is 11 kg in, 6 kg out = 54.5%.
  // Averaging the two ratios would say 75% — flattering, and wrong.
  const s = Y.summarise([mk(10, null, 5), mk(1, null, 1)]);
  expect(s.pct).toBe(54.55);
  expect(s.count).toBe(2);
});

test('the piece count gives kg per piece, raw and usable', () => {
  const s = Y.summarise([mk(4, 12, 2.55)]);
  expect(s.perPieceRaw).toBeCloseTo(0.333333, 5);
  expect(s.perPieceUsable).toBeCloseTo(0.2125, 5);
  expect(s.pct).toBe(63.75);
});

test('tests without a piece count still count towards the yield', () => {
  const s = Y.summarise([mk(4, 12, 2), mk(4, null, 2)]);
  expect(s.count).toBe(2);            // both weighed
  expect(s.countWithPieces).toBe(1);  // only one counted
  expect(s.perPieceRaw).toBeCloseTo(4 / 12, 5);   // the uncounted one is not in it
});

test('only the most recent tests count, and the rest are reported as older', () => {
  // Eleven tests: ten fresh ones at 50%, one ancient at 10% that must fall out.
  const fresh = Array.from({ length: 10 }, (_, i) => mk(10, 10, 5, i));
  const ancient = mk(10, 10, 1, 50);
  const s = Y.summarise([...fresh, ancient]);
  expect(s.count).toBe(10);
  expect(s.older).toBe(1);
  expect(s.pct).toBe(50);
});

test('the window is applied newest-first even when handed over backwards', () => {
  const rows = [mk(10, 10, 1, 50), ...Array.from({ length: 10 }, (_, i) => mk(10, 10, 5, i))];
  expect(Y.summarise(rows).pct).toBe(50);          // not 10
});

test('spread reports how much the pieces disagree', () => {
  const s = Y.summarise([mk(1, 10, 0.5), mk(2, 10, 1), mk(3, 10, 1.5)]);
  expect(s.perPieceMin).toBe(0.1);
  expect(s.perPieceMax).toBe(0.3);
  expect(s.perPieceSpreadPct).toBe(100);           // 0.2 span on a 0.2 average
});

test('true cost divides by the yield, and refuses the impossible ones', () => {
  expect(Y.trueCost(2, 0.64)).toBe(3.13);
  expect(Y.trueCost(2, 0)).toBeNull();             // never Infinity on a screen
  expect(Y.trueCost(null, 0.64)).toBeNull();
  expect(Y.trueCost(0, 0.64)).toBeNull();
  expect(Y.trueCost(2, null)).toBeNull();
});

test('no tests means no numbers, not zero', () => {
  const s = Y.summarise([]);
  expect(s.count).toBe(0);
  expect(s.pct).toBeNull();
  expect(s.fraction).toBeNull();
});

// ── what may be entered ──

test('a heavier usable weight is rejected, and says why', () => {
  const msg = Y.validate({ raw_qty: 2, usable_qty: 3 });
  expect(msg).toContain('wrong way round');
});

test('zero, negative and fractional pieces are refused', () => {
  expect(Y.validate({ raw_qty: 0, usable_qty: 0 })).toBeTruthy();
  expect(Y.validate({ raw_qty: -1, usable_qty: 0 })).toBeTruthy();
  expect(Y.validate({ raw_qty: 4, usable_qty: 2, pieces: 2.5 })).toBeTruthy();
  expect(Y.validate({ raw_qty: 4, usable_qty: 2, pieces: -1 })).toBeTruthy();
  expect(Y.validate({ raw_qty: 4, usable_qty: 2, pieces: 12 })).toBeNull();
  expect(Y.validate({ raw_qty: 4, usable_qty: 4 })).toBeNull();      // 100% is legal
});

test('"none" and "zero" pieces are stored as the same thing', () => {
  expect(Y.normalisePieces(0)).toBeNull();
  expect(Y.normalisePieces(null)).toBeNull();
  expect(Y.normalisePieces(12)).toBe(12);
});

// ── who may be tested ──

test('a product counted in Units cannot have a yield test', () => {
  expect(Y.eligibility('Units').canTest).toBe(false);
  expect(Y.eligibility('kg').canTest).toBe(true);
  expect(Y.eligibility('L').canTest).toBe(true);
  expect(Y.eligibility('').canTest).toBe(false);
});

// ── the pack-size offer: the dangerous one ──

const threeTests = [mk(3, 100, 2, 3), mk(3, 100, 2, 2), mk(3, 100, 2, 1)];   // 0.03 each

test('a crate of 20 bottles is never offered a measured size', () => {
  const s = Y.summarise(threeTests);
  expect(Y.packOffer('Units', 20, s, true)).toBeNull();
});

test('a kg pack is NOT offered until somebody says it varies', () => {
  const s = Y.summarise(threeTests);
  // This is the "Ketchup 10kg Eimer" guard: three slightly-underfilled buckets
  // must not be able to redefine a declared pack weight.
  expect(Y.packOffer('kg', 0.05, s, null)).toBeNull();     // nobody asked yet
  expect(Y.packOffer('kg', 0.05, s, false)).toBeNull();    // declared, exact
  expect(Y.packOffer('kg', 0.05, s, true)).not.toBeNull(); // a bunch — measure it
});

test('the question is asked once there is enough evidence, and not after answering', () => {
  const few = Y.summarise([mk(3, 100, 2)]);
  const many = Y.summarise(threeTests);
  expect(Y.needsPackClassification('kg', null, few)).toBe(false);   // too early
  expect(Y.needsPackClassification('kg', null, many)).toBe(true);
  expect(Y.needsPackClassification('kg', true, many)).toBe(false);  // answered
  expect(Y.needsPackClassification('kg', false, many)).toBe(false);
  expect(Y.needsPackClassification('Units', null, many)).toBe(false);
});

test('two tests are not enough to move a pack size', () => {
  const s = Y.summarise(threeTests.slice(0, 2));
  expect(Y.packOffer('kg', 0.05, s, true)).toBeNull();
});

test('a pack size that is already right is not offered again', () => {
  const s = Y.summarise(threeTests);
  expect(Y.packOffer('kg', 0.03, s, true)).toBeNull();       // exact
  expect(Y.packOffer('kg', 0.0301, s, true)).toBeNull();     // within 2%
  expect(Y.packOffer('kg', 0.04, s, true)).not.toBeNull();   // 33% out
});

test('the offer uses the RAW piece weight, never the usable one', () => {
  // Staff count unpeeled plantains on a shelf, so the multiplier must describe
  // what they are looking at — usable would silently under-count every shelf.
  const s = Y.summarise([mk(4, 12, 2, 3), mk(4, 12, 2, 2), mk(4, 12, 2, 1)]);
  const offer = Y.packOffer('kg', 0.1, s, true);
  expect(offer.measured).toBeCloseTo(4 / 12, 5);
  expect(offer.measured).not.toBeCloseTo(2 / 12, 5);
});

test('a wide spread is flagged rather than hidden', () => {
  const s = Y.summarise([mk(1, 10, 0.5, 3), mk(3, 10, 1.5, 2), mk(2, 10, 1, 1)]);
  const offer = Y.packOffer('kg', 0.5, s, true);
  expect(offer.wideSpread).toBe(true);
  const tight = Y.summarise(threeTests);
  expect(Y.packOffer('kg', 0.05, tight, true).wideSpread).toBe(false);
});

test('setting the first pack size is marked as such', () => {
  const s = Y.summarise(threeTests);
  const offer = Y.packOffer('kg', null, s, true);
  expect(offer.isFirst).toBe(true);
  expect(offer.current).toBeNull();
  expect(Y.packOffer('kg', 0.05, s, true).isFirst).toBe(false);
});

test('a par keeps the number of bunches a manager asked for', () => {
  // 0.30 kg was "10 bunches at 0.030". At 0.026 it must become 0.26 kg, still
  // ten bunches — not stay at 0.30 and quietly read as 11.5.
  expect(Y.rescalePar(0.3, 0.03, 0.026)).toBeCloseTo(0.26, 6);
  expect(Y.rescalePar(null, 0.03, 0.026)).toBeNull();
  expect(Y.rescalePar(0.3, 0, 0.026)).toBeNull();
});

// ── the store ──

test('a retried save does not become a second measurement', () => {
  db.initInventoryTables();
  const args = {
    productId: 7911, companyId: CO, rawQty: 4, pieces: 12, usableQty: 2.55,
    note: null, userId: 1, clientKey: 'retry-me',
  };
  const first = db.addYieldTest(args);
  const second = db.addYieldTest(args);
  expect(second.id).toBe(first.id);
  expect(db.getYieldTests(7911)).toHaveLength(1);
});

test('two different readings both save', () => {
  db.initInventoryTables();
  db.addYieldTest({ productId: 7912, companyId: CO, rawQty: 4, pieces: 12, usableQty: 2.5, note: null, userId: 1, clientKey: 'a' });
  db.addYieldTest({ productId: 7912, companyId: CO, rawQty: 5, pieces: 14, usableQty: 3.0, note: null, userId: 1, clientKey: 'b' });
  expect(db.getYieldTests(7912)).toHaveLength(2);
});

test('a test can only be deleted by the restaurant that recorded it', () => {
  db.initInventoryTables();
  const t = db.addYieldTest({ productId: 7913, companyId: CO, rawQty: 4, pieces: 12, usableQty: 2.5, note: null, userId: 1, clientKey: null });
  expect(db.deleteYieldTest(t.id, CO_OTHER)).toBe(false);
  expect(db.getYieldTests(7913)).toHaveLength(1);
  expect(db.deleteYieldTest(t.id, CO)).toBe(true);
  expect(db.getYieldTests(7913)).toHaveLength(0);
});

test('tests come back newest first, so the rolling window is the recent one', () => {
  db.initInventoryTables();
  for (let i = 0; i < 3; i++) {
    db.addYieldTest({ productId: 7914, companyId: CO, rawQty: i + 1, pieces: 10, usableQty: 0.5, note: null, userId: 1, clientKey: `w${i}` });
  }
  const rows = db.getYieldTests(7914);
  expect(rows).toHaveLength(3);
  expect(rows[0].raw_qty).toBe(3);
});

test('the pack-varies answer is a tri-state and survives a round trip', () => {
  db.initInventoryTables();
  const read = () => db.getProductFlags([7915])[0]?.pack_varies;
  // Start from "nobody has said" explicitly. The unit project reuses ONE db file
  // across runs (playwright.config.ts), so a spec that assumed an empty table
  // would pass once and fail forever after.
  db.setProductPackVaries(7915, null, 1);
  expect(read()).toBeNull();
  db.setProductPackVaries(7915, true, 1);
  expect(read()).toBe(true);
  db.setProductPackVaries(7915, false, 1);
  expect(read()).toBe(false);
  db.setProductPackVaries(7915, null, 1);
  expect(read()).toBeNull();                      // asked again, not "exact"
});

test('applying a measured size keeps every restaurant\'s par the same in packs', () => {
  db.initInventoryTables();
  const P = 7917;
  db.setProductCrateSize(P, 0.03, 1);
  // Two restaurants, both wanting ten bunches on hand: 0.30 kg at 0.030 each.
  db.setProductPar(P, CO, 0.3, 0.6, 1);
  db.setProductPar(P, CO_OTHER, 0.3, null, 1);

  const { parsRescaled } = db.applyMeasuredPackSize(P, 0.03, 0.026, 1);
  expect(parsRescaled).toBe(2);
  expect(db.getProductFlags([P])[0].units_per_crate).toBe(0.026);
  // Still ten bunches (and twenty), not 11.5 — the base moved, the intent did not.
  const mine = db.getProductPar(CO, [P])[0];
  expect(mine.par_min / 0.026).toBeCloseTo(10, 6);
  expect(mine.par_max / 0.026).toBeCloseTo(20, 6);
  expect(db.getProductPar(CO_OTHER, [P])[0].par_min / 0.026).toBeCloseTo(10, 6);
});

test('a pack size that moved under us is refused, not overwritten', () => {
  db.initInventoryTables();
  const P = 7919;
  db.setProductCrateSize(P, 0.03, 1);
  db.setProductPar(P, CO, 0.3, null, 1);

  // Somebody else set it to 0.04 after this caller read 0.03. Writing anyway
  // would clobber their number AND rescale the par by the wrong divisor.
  db.setProductCrateSize(P, 0.04, 2);
  const res = db.applyMeasuredPackSize(P, 0.03, 0.026, 1);

  expect(res.conflict).toBe(true);
  expect(res.parsRescaled).toBe(0);
  expect(db.getProductFlags([P])[0].units_per_crate).toBe(0.04);   // theirs stands
  expect(db.getProductPar(CO, [P])[0].par_min).toBe(0.3);          // par untouched
});

test('an idempotency key never leaves the server', () => {
  db.initInventoryTables();
  const P = 7920;
  db.addYieldTest({ productId: P, companyId: CO, rawQty: 4, pieces: 12, usableQty: 2.5, note: null, userId: 1, clientKey: 'secret-token' });
  const row = db.getYieldTests(P)[0];
  expect(row.raw_qty).toBe(4);
  expect('client_key' in row).toBe(false);
});

test('an impossibly small yield gives no price rather than Infinity', () => {
  expect(Y.trueCost(2, 1e-308)).toBeNull();
  expect(Y.trueCost(2, 0.5)).toBe(4);
});

test('setting a FIRST pack size does not touch a par', () => {
  db.initInventoryTables();
  const P = 7918;
  db.setProductCrateSize(P, null, 1);
  db.setProductPar(P, CO, 5, null, 1);
  const { parsRescaled } = db.applyMeasuredPackSize(P, null, 0.25, 1);
  expect(parsRescaled).toBe(0);
  expect(db.getProductPar(CO, [P])[0].par_min).toBe(5);   // still 5 base units
});

test('answering the pack question leaves the pack size alone', () => {
  db.initInventoryTables();
  db.setProductCrateSize(7916, 0.03, 1);
  db.setProductPackVaries(7916, true, 1);
  const f = db.getProductFlags([7916])[0];
  expect(f.units_per_crate).toBe(0.03);
  expect(f.pack_varies).toBe(true);
});

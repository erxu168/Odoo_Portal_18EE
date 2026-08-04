import { test, expect } from '@playwright/test';
import { houseCode, parseHouseCode, needsHouseCode } from '../src/lib/product-code';
import { parseLocationCode } from '../src/lib/location-code';

/**
 * The house code a product gets when it has no supplier barcode — 824 of WAJ's
 * products had none, and a shelf label with nothing to scan is a sticker with
 * no point.
 *
 * THE test in here is the last one: a shelf label prints BOTH codes, so they
 * must never be mistaken for one another in either direction.
 */

test('the code is stable and derived from the product', () => {
  expect(houseCode(1546)).toBe('KRW-1546');
  expect(parseHouseCode(houseCode(1546))).toBe(1546);
  // Unique by construction — two managers running the bulk at once cannot clash.
  expect(new Set([1, 2, 3].map(houseCode)).size).toBe(3);
});

test('a scanner’s stray whitespace and casing still resolve', () => {
  expect(parseHouseCode('  KRW-1546 ')).toBe(1546);
  expect(parseHouseCode('krw-1546')).toBe(1546);
});

test('junk is not a product code', () => {
  for (const j of ['KRW-', 'KRW-abc', 'XKRW-1', '1546', '', '   ']) {
    expect(parseHouseCode(j), `${j} must not parse`).toBeNull();
  }
});

test('only an EMPTY barcode needs one — a supplier EAN always wins', () => {
  expect(needsHouseCode(null)).toBe(true);
  expect(needsHouseCode(false)).toBe(true);
  expect(needsHouseCode('')).toBe(true);
  expect(needsHouseCode('   ')).toBe(true);
  expect(needsHouseCode('4105250022003')).toBe(false);
  expect(needsHouseCode('KRW-1546')).toBe(false);
});

test('THE COLLISION: the two codes on one label can never be confused', () => {
  // Both are printed on the same 90x60 sticker, inches apart.
  expect(parseLocationCode(houseCode(38)), 'a product code is not a shelf').toBeNull();
  expect(parseHouseCode('KWLOC-38'), 'a shelf code is not a product').toBeNull();
  // And the ids overlapping changes nothing — product 38 and shelf 38 coexist.
  expect(parseHouseCode(houseCode(38))).toBe(38);
  expect(parseLocationCode('KWLOC-38')).toBe(38);
});

import { test, expect } from '@playwright/test';
import { parseLocationCode, locationCode, locationDeepLink } from '../src/lib/location-code';

/**
 * A shelf label carries TWO codes: the product's own barcode and the shelf's
 * code. Aiming a camera at the wrong one is ordinary — so what must NEVER
 * happen is the shelf code reaching the product lookup, coming back "unknown",
 * and the scan-to-create flow offering to make a product called KWLOC-38.
 *
 * That was live before shelf labels existed: parseLocationCode was written for
 * the label screen and wired in NOWHERE else. These pin the classifier every
 * scan entry point now depends on. (Ethan asked "won't the two barcodes
 * collide?", 2026-08-04 — this is the answer.)
 */

test('a shelf code is recognised as a place, not a product', () => {
  expect(parseLocationCode('KWLOC-38')).toBe(38);
  expect(parseLocationCode(locationCode(1234))).toBe(1234);
});

test('the older sticker generation — a floorplan link — still scans', () => {
  expect(parseLocationCode(locationDeepLink(77))).toBe(77);
  expect(parseLocationCode('https://staff.krawings.de/inventory/floorplan?spot=77')).toBe(77);
});

test('a REAL product barcode is never mistaken for a shelf', () => {
  for (const real of ['4105250022003', '8936146201419', '40173894', '2000000008486']) {
    expect(parseLocationCode(real), `${real} is a product`).toBeNull();
  }
});

test('the generated product code is never mistaken for a shelf', () => {
  // Both live on the same label, so this is the collision that matters.
  expect(parseLocationCode('KRW-1546')).toBeNull();
  expect(parseLocationCode('KRW-38')).toBeNull();
});

test('near-misses are not treated as shelves', () => {
  for (const junk of ['KWLOC-', 'KWLOC-abc', 'XKWLOC-38', 'KWLOC-38-2', '', '   ']) {
    expect(parseLocationCode(junk), `${junk} must not parse`).toBeNull();
  }
});

test('a scanner’s stray whitespace and casing still resolve', () => {
  expect(parseLocationCode('  KWLOC-38  ')).toBe(38);
  expect(parseLocationCode('kwloc-38')).toBe(38);
});

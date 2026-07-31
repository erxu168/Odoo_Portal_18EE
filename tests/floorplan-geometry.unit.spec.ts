import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  pointInPolygon,
  textItemPolygon,
  rotationDegrees,
  polygonCentroid,
  groupTokens,
  itemsToTokens,
  classify,
  normalizeCode,
} from '../src/lib/inventory-floorplan/geometry';

/**
 * Geometry math + label grouping, pinned against the owner's REAL SSK96 v1.3
 * plan (tests/fixtures). The fixture matters more than the synthetic cases:
 * pdf.js tokenizes differently from pdftotext (many labels arrive pre-joined,
 * the small square labels are TWO-LINE — "FLS" with the number stacked below),
 * and several labels are rotated. If a pdfjs upgrade changes tokenization,
 * this spec is meant to break loudly.
 */

test('textItemPolygon maps an unrotated text box into page fractions (y down)', () => {
  const poly = textItemPolygon({ transform: [1, 0, 0, 1, 100, 690], width: 40, height: 10 }, 1000, 1000);
  const want = [
    { x: 0.1, y: 0.31 }, { x: 0.14, y: 0.31 }, { x: 0.14, y: 0.3 }, { x: 0.1, y: 0.3 },
  ];
  poly.forEach((p, i) => {
    expect(p.x).toBeCloseTo(want[i].x, 5);
    expect(p.y).toBeCloseTo(want[i].y, 5);
  });
});

test('textItemPolygon uses unit direction vectors — font scale in the transform must not double-apply', () => {
  // "REF 1"-shaped item from the real plan: fontsize 9 in the matrix, width/height already in page units.
  const poly = textItemPolygon({ transform: [9, 0, 0, 9, 100, 100], width: 22.1, height: 9 }, 1000, 1000);
  expect(poly[1].x - poly[0].x).toBeCloseTo(0.0221, 4); // 22.1 page units, NOT 22.1*9
  expect(poly[0].y - poly[3].y).toBeCloseTo(0.009, 4);
});

test('rotation: 90° vertical text box', () => {
  expect(rotationDegrees([0, 1, -1, 0, 500, 500])).toBe(90);
  const poly = textItemPolygon({ transform: [0, 1, -1, 0, 500, 500], width: 40, height: 10 }, 1000, 1000);
  expect(poly[0].x).toBeCloseTo(0.5, 5);
  expect(poly[0].y).toBeCloseTo(0.5, 5);
  expect(poly[1].x).toBeCloseTo(0.5, 5);
  expect(poly[1].y).toBeCloseTo(0.46, 5); // baseline runs upward on the page
  expect(poly[2].x).toBeCloseTo(0.49, 5);
});

test('polygonCentroid averages the corners', () => {
  const c = polygonCentroid([{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.1 }, { x: 0, y: 0.1 }]);
  expect(c.x).toBeCloseTo(0.1, 5);
  expect(c.y).toBeCloseTo(0.05, 5);
});

test('classify: storage prefixes, rooms, and everything else', () => {
  expect(classify('SLF 1')).toEqual({ kind: 'spot', type: 'shelf' });
  expect(classify('fls 12')).toEqual({ kind: 'spot', type: 'floorspace' });
  expect(classify('CAB')).toEqual({ kind: 'spot', type: 'cabinet' });
  expect(classify('REF 1')).toEqual({ kind: 'spot', type: 'fridge' });
  expect(classify('FRZ 2')).toEqual({ kind: 'spot', type: 'freezer' });
  expect(classify('Fridge Room').kind).toBe('room');
  expect(classify('Basement Entrance Area').kind).toBe('room');
  expect(classify('WASH M (Washroom Male)').kind).toBe('room');
  expect(classify('Entry/ Exit').kind).toBe('room');
  expect(classify('Naming System:').kind).toBe('other');
  expect(classify('2,75').kind).toBe('other');
  expect(normalizeCode('  slf   1 ')).toBe('SLF 1');
});

test('grouping joins a stacked type+number label but never two full codes', () => {
  // Two-line square label: "FLS" with "2" centered below (real geometry from the plan,
  // fontsize 6: "FLS" at (550.26,298.39) w=10.5, "2" at (553.9,291.19) w=3.3).
  const stacked = itemsToTokens([
    { str: 'FLS', transform: [6, 0, 0, 6, 550.26, 298.39], width: 10.5, height: 6 },
    { str: '2', transform: [6, 0, 0, 6, 553.9, 291.19], width: 3.3, height: 6 },
  ], 841.89, 595.276);
  const g1 = groupTokens(stacked, 841.89, 595.276);
  expect(g1.length).toBe(1);
  expect(normalizeCode(g1[0].text)).toBe('FLS 2');

  // Two complete vertical codes side by side must stay separate.
  const twoCodes = itemsToTokens([
    { str: 'SLF 1', transform: [-0.05, 11, -11, -0.05, 454.91, 203.85], width: 27.8, height: 11 },
    { str: 'SLF 2', transform: [-0.05, 11, -11, -0.05, 455.05, 169.12], width: 27.8, height: 11 },
  ], 841.89, 595.276);
  const g2 = groupTokens(twoCodes, 841.89, 595.276);
  expect(g2.length).toBe(2);
});

test('REAL PLAN: extraction finds the storage labels and rooms of SSK96 -1F', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'floorplan-ssk96-v13.pdf')));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const tokens = itemsToTokens(
    (tc.items as Array<{ str: string; transform: number[]; width: number; height: number }>).filter(i => i.str.trim() !== ''),
    vp.width, vp.height,
  );
  const groups = groupTokens(tokens, vp.width, vp.height);
  const spots = groups.filter(g => classify(normalizeCode(g.text)).kind === 'spot');
  const spotCodes = spots.map(s => normalizeCode(s.text));

  // Pinned against pdfjs-dist 4.8.69 tokenization of the v1.3 plan. If a pdfjs
  // upgrade shifts these, re-verify on-screen before re-pinning.
  expect(spotCodes).toContain('FRZ 2');
  expect(spotCodes).toContain('REF 1');
  expect(spotCodes).toContain('CAB 1');
  expect(spotCodes).toContain('SLF 1');
  expect(spotCodes.length).toBe(38);
  expect(spotCodes.every(c => /\d/.test(c))).toBe(true); // every spot candidate has its number

  // The legend's bare type column chains into ONE ignorable blob instead of
  // five fake spot candidates — deliberate: one untick in review, not five.
  const legend = groups.find(g => normalizeCode(g.text) === 'SLF FLS CAB REF FRZ');
  expect(legend).toBeTruthy();
  expect(classify(normalizeCode(legend!.text)).kind).toBe('other');

  const rooms = groups.filter(g => classify(normalizeCode(g.text)).kind === 'room').map(g => g.text);
  expect(rooms.join('|')).toContain('Fridge Room');
  expect(rooms.join('|')).toContain('Drinks Room');
  expect(rooms.join('|')).toContain('Changing Room');
  expect(rooms.join('|')).toContain('DISPATCH AREA');

  // every stored polygon must satisfy the publish-time invariant 0 ≤ x,y ≤ 1
  for (const g of groups) {
    for (const p of g.poly) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  }
});

test('pointInPolygon: inside, outside, and non-rectangular', () => {
  const box = [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.5 }, { x: 0.2, y: 0.5 }];
  expect(pointInPolygon({ x: 0.4, y: 0.35 }, box)).toBe(true);
  expect(pointInPolygon({ x: 0.1, y: 0.35 }, box)).toBe(false);
  const tri = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }];
  expect(pointInPolygon({ x: 0.5, y: 0.4 }, tri)).toBe(true);
  expect(pointInPolygon({ x: 0.05, y: 0.9 }, tri)).toBe(false);
});

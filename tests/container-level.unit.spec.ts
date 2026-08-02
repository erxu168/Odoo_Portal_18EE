import { test, expect } from '@playwright/test';
import fs from 'fs'; import os from 'os'; import path from 'path';

/**
 * Container-level counting: the marked quarter feeds the EXISTING loose
 * quantity, and the review glyph derives the quarter back from it. The math
 * must round-trip exactly, or a marked ¾ would re-open as words-only.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-level-'));
process.env.PORTAL_DB_PATH = path.join(dir, 'portal.db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cu = require('../src/lib/crate-units');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../src/lib/inventory-db');

test('a marked quarter converts to litres and BACK to the same quarter', () => {
  // 10 L bucket / 20 L tub / 30 L drum / 0.7 L bottle — every quarter of each.
  for (const size of [10, 20, 30, 0.7]) {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const loose = cu.looseFromFraction(f, size);
      expect(cu.quarterFromLoose(loose, size), `${f} of ${size}`).toBe(f);
    }
  }
  // The floating-point-dust case the codebase already guards elsewhere:
  // bunches of 0.03 kg.
  expect(cu.quarterFromLoose(cu.looseFromFraction(0.75, 0.03), 0.03)).toBe(0.75);
});

test('a loose amount that is NOT a clean quarter yields null — words only', () => {
  expect(cu.quarterFromLoose(3.33, 10)).toBeNull();
  expect(cu.quarterFromLoose(7.5, 20)).toBeNull();     // ⅜ of a 20 L tub
  expect(cu.quarterFromLoose(11, 10)).toBeNull();      // more than a full one
  expect(cu.quarterFromLoose(2.5, 0)).toBeNull();      // no pack size
});

test("a product's level shape persists, comes back with the flags, and clears", () => {
  db.initInventoryTables();
  const PID = 91001;
  db.setProductLevelShape(PID, 'round', 1);
  let flag = db.getProductFlags([PID])[0];
  expect(flag.level_shape).toBe('round');

  // Setting another field must not wipe it (the upserts leave siblings alone).
  db.setProductCrateSize(PID, 10, 1);
  flag = db.getProductFlags([PID])[0];
  expect(flag.level_shape).toBe('round');
  expect(flag.units_per_crate).toBe(10);

  db.setProductLevelShape(PID, null, 1);
  flag = db.getProductFlags([PID])[0];
  expect(flag.level_shape).toBeNull();
});

test.afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

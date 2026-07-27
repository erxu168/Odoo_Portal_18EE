import { test, expect } from '@playwright/test';
import {
  usableLevels, countableLevels, hasPackaging, packTotal, splitToLevels,
  describeChain, validateLevels, type PackLevel,
} from '../src/lib/packaging';

// Ethan's real case: Bekarei buns arrive in boxes of 30, three sealed 10-packs
// to a box. The ledger stores pieces.
const BOX: PackLevel = { id: 1, name: 'box', toBase: 30, countable: true, allowPartial: false };
const PACK: PackLevel = { id: 2, name: 'pack', toBase: 10, countable: true, allowPartial: false };
const BUNS = [BOX, PACK];

// A drinks crate: one level, the shape most products already use.
const CRATE: PackLevel = { id: 9, name: 'crate', toBase: 24, countable: true, allowPartial: false };

// --- the headline conversion -------------------------------------------------

test('2 boxes + 1 sealed pack + 4 loose = 74 pieces', () => {
  expect(packTotal({ byLevel: { 1: 2, 2: 1 }, loose: 4 }, BUNS)).toBe(74);
});

test('74 pieces reads back as the same count the staff member entered', () => {
  const split = splitToLevels(74, BUNS);
  expect(split.byLevel[BOX.id]).toBe(2);
  expect(split.byLevel[PACK.id]).toBe(1);
  expect(split.loose).toBe(4);
  // and round-trips
  expect(packTotal(split, BUNS)).toBe(74);
});

test('levels are used biggest-first regardless of the order they arrive in', () => {
  const jumbled = [PACK, BOX];
  expect(usableLevels(jumbled).map((l) => l.name)).toEqual(['box', 'pack']);
  const split = splitToLevels(74, jumbled);
  expect(split.byLevel[BOX.id]).toBe(2);   // not 7 packs + 4
  expect(split.byLevel[PACK.id]).toBe(1);
});

// --- the float traps that already bit the single-level engine ----------------

test('eleven bunches of 0.03 do not read back as ten', () => {
  const BUNCH: PackLevel = { id: 3, name: 'bunch', toBase: 0.03, countable: true, allowPartial: false };
  const total = packTotal({ byLevel: { 3: 11 }, loose: 0 }, [BUNCH]);
  expect(splitToLevels(total, [BUNCH]).byLevel[BUNCH.id]).toBe(11);
});

test('a total carries no binary dust', () => {
  const L: PackLevel = { id: 4, name: 'tray', toBase: 0.1, countable: true, allowPartial: false };
  expect(packTotal({ byLevel: { 4: 3 }, loose: 0 }, [L])).toBe(0.3);
});

// --- levels that must NOT be used --------------------------------------------

test('a non-countable level converts but is never split into', () => {
  const PALLET: PackLevel = { id: 5, name: 'pallet', toBase: 300, countable: false, allowPartial: false };
  const levels = [PALLET, ...BUNS];
  // it still converts if something was stored against it…
  expect(packTotal({ byLevel: { 5: 1 }, loose: 0 }, levels)).toBe(300);
  // …but staff are never shown a pallet to verify
  expect(countableLevels(levels).map((l) => l.name)).toEqual(['box', 'pack']);
  expect(splitToLevels(300, levels).byLevel[PALLET.id]).toBeUndefined();
  expect(splitToLevels(300, levels).byLevel[BOX.id]).toBe(10);
});

test('a level deleted after the count is ignored, never re-priced at another rate', () => {
  // 2 of a level that no longer exists must contribute 0 — not 2 boxes.
  expect(packTotal({ byLevel: { 99: 2 }, loose: 5 }, BUNS)).toBe(5);
});

test('a zero or negative conversion is dropped, not divided by', () => {
  const BAD: PackLevel = { id: 6, name: 'broken', toBase: 0, countable: true, allowPartial: false };
  expect(usableLevels([BAD, CRATE]).map((l) => l.name)).toEqual(['crate']);
  expect(() => splitToLevels(48, [BAD, CRATE])).not.toThrow();
  expect(splitToLevels(48, [BAD, CRATE]).byLevel[CRATE.id]).toBe(2);
});

// --- single level behaves exactly like the crate engine ----------------------

test('one crate level matches the existing crate/loose behaviour', () => {
  expect(packTotal({ byLevel: { 9: 3 }, loose: 7 }, [CRATE])).toBe(79);
  const s = splitToLevels(79, [CRATE]);
  expect(s.byLevel[CRATE.id]).toBe(3);
  expect(s.loose).toBe(7);
});

test('with no packaging at all everything is loose', () => {
  expect(hasPackaging([])).toBe(false);
  expect(splitToLevels(12, [])).toEqual({ byLevel: {}, loose: 12 });
  expect(packTotal({ byLevel: {}, loose: 12 }, [])).toBe(12);
});

// --- description + validation ------------------------------------------------

test('the chain is described in the words staff use', () => {
  expect(describeChain(BUNS, 'pieces')).toBe('1 box = 3 packs · 1 pack = 10 pieces');
});

test('a duplicate size and a duplicate name are both reported', () => {
  const dupSize: PackLevel = { id: 7, name: 'carton', toBase: 30, countable: true, allowPartial: false };
  const problems = validateLevels([BOX, dupSize]);
  expect(problems.some((p) => /redundant/.test(p.message))).toBe(true);

  const dupName: PackLevel = { id: 8, name: 'Box', toBase: 12, countable: true, allowPartial: false };
  expect(validateLevels([BOX, dupName]).some((p) => /two levels called/.test(p.message))).toBe(true);
});

test('a valid chain reports no problems', () => {
  expect(validateLevels(BUNS)).toEqual([]);
});

// --- the split is for eyes, not for storage ---------------------------------

test('a fractional remainder is rounded for display, so the split is not a data path', () => {
  // 0.333 kg with no packaging shows as 0.33 — the STORED total stays 0.333 and
  // must never be recomputed from this split, or the third decimal walks away.
  const split = splitToLevels(0.333, []);
  expect(split.loose).toBe(0.33);
  expect(packTotal(split, [])).not.toBe(0.333);
});

test('levels that are not multiples of each other still round-trip whole counts', () => {
  const BIG: PackLevel = { id: 20, name: 'case', toBase: 30, countable: true, allowPartial: false };
  const ODD: PackLevel = { id: 21, name: 'tray', toBase: 12, countable: true, allowPartial: false };
  for (const n of [24, 35, 40, 42, 66, 100]) {
    expect(packTotal(splitToLevels(n, [BIG, ODD]), [BIG, ODD])).toBe(n);
  }
});

test('a negative total never invents packs', () => {
  const s = splitToLevels(-10, [CRATE]);
  expect(s.byLevel[CRATE.id]).toBeUndefined();
  expect(s.loose).toBe(-10);
});

test('a hostile key in the level record cannot reach the total', () => {
  const evil = { byLevel: JSON.parse('{"__proto__": 5, "constructor": 7}'), loose: 3 } as never;
  expect(packTotal(evil, BUNS)).toBe(3);
});

// --- the hardening the adversarial review demanded ---------------------------

test('two levels sharing an id cannot silently swallow stock', () => {
  // 30 and 12 under the SAME id: the split wrote both into one slot and 42 came
  // back as 12. The clash is reported, and only the first id is ever used.
  const a: PackLevel = { id: 1, name: 'case', toBase: 30, countable: true, allowPartial: false };
  const b: PackLevel = { id: 1, name: 'tray', toBase: 12, countable: true, allowPartial: false };
  expect(validateLevels([a, b]).some((p) => /same id/.test(p.message))).toBe(true);
  expect(usableLevels([a, b])).toHaveLength(1);
  expect(packTotal(splitToLevels(42, [a, b]), [a, b])).toBe(42);
});

test('a conversion too small to store is refused, not silently zeroed', () => {
  const tiny: PackLevel = { id: 2, name: 'speck', toBase: 4e-7, countable: true, allowPartial: false };
  expect(validateLevels([tiny]).some((p) => /too small/.test(p.message))).toBe(true);
  expect(usableLevels([tiny])).toHaveLength(0);
});

test('a conversion large enough to overflow is refused', () => {
  const huge: PackLevel = { id: 3, name: 'mountain', toBase: 1e308, countable: true, allowPartial: false };
  expect(validateLevels([huge]).some((p) => /larger than/.test(p.message))).toBe(true);
  expect(usableLevels([huge])).toHaveLength(0);
});

test('a level worth exactly one base unit is the base unit, not packaging', () => {
  const one: PackLevel = { id: 4, name: 'piece', toBase: 1, countable: true, allowPartial: false };
  expect(validateLevels([one]).some((p) => /base unit itself/.test(p.message))).toBe(true);
  expect(hasPackaging([one])).toBe(false);   // used to be true while the split skipped it
});

test('a quantity that is not a number fails loudly instead of becoming zero stock', () => {
  expect(() => packTotal({ byLevel: { 1: NaN }, loose: 0 }, BUNS)).toThrow(/PACK_BAD_QUANTITY/);
  expect(() => packTotal({ byLevel: { 1: Infinity }, loose: 0 }, BUNS)).toThrow(/PACK_BAD_QUANTITY/);
  expect(() => packTotal({ byLevel: {}, loose: NaN }, BUNS)).toThrow(/PACK_BAD_QUANTITY/);
});

test('an overflowing count is refused rather than rounding to nothing', () => {
  expect(() => packTotal({ byLevel: { 1: Number.MAX_VALUE }, loose: Number.MAX_VALUE }, BUNS))
    .toThrow(/PACK_OVERFLOW/);
});

test('numeric-looking key variants cannot count the same level several times', () => {
  // "1", "01", "1e0" and "0x1" all coerce to 1 — walking the record let one box
  // be counted four times (450 instead of 30).
  const evil = { byLevel: JSON.parse('{"1":1,"01":2,"1e0":4,"0x1":8}'), loose: 0 } as never;
  expect(packTotal(evil, BUNS)).toBe(30);
});

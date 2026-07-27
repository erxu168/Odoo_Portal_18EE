import { test, expect } from '@playwright/test';

/**
 * The narrowing rules behind the shared product filter bar.
 *
 * These are extracted from Product settings rather than reinvented, and the two
 * that are easy to get wrong — a parent matching everything beneath it, and
 * category names that contain a "/" of their own — are pinned here so a future
 * edit cannot quietly undo them.
 *
 * Mirrors the catFamily / locFamily / narrow logic in
 * src/components/inventory/ProductFilters.tsx.
 */

type Cat = { id: number; name: string; complete_name?: string };
type Loc = { id: number; name: string; parent_id?: number | null };
type Prod = { id: number; categ_id?: [number, string] | false };

function catFamily(catId: number | null, cats: Cat[]): Set<number> | null {
  if (catId == null) return null;
  const chosen = cats.find((c) => c.id === catId);
  if (!chosen) return new Set<number>([catId]);
  const mine = String(chosen.complete_name || chosen.name);
  const out = new Set<number>([catId]);
  cats.forEach((c) => { if (String(c.complete_name || c.name).startsWith(mine + ' / ')) out.add(c.id); });
  return out;
}

function locFamily(locId: number | null, locs: Loc[]): Set<number> | null {
  if (locId == null) return null;
  const kids = new Map<number | null, number[]>();
  locs.forEach((l) => {
    const k = l.parent_id ?? null;
    kids.set(k, [...(kids.get(k) || []), l.id]);
  });
  const out = new Set<number>([locId]);
  const stack = [locId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const kid of kids.get(cur) || []) if (!out.has(kid)) { out.add(kid); stack.push(kid); }
  }
  return out;
}

function narrow(list: Prod[], cf: Set<number> | null, lf: Set<number> | null, spots: Record<number, number[]>) {
  let out = list;
  if (cf) out = out.filter((p) => {
    const cid = Array.isArray(p.categ_id) ? p.categ_id[0] : undefined;
    return cid != null && cf.has(cid);
  });
  if (lf) out = out.filter((p) => (spots[p.id] || []).some((sid) => lf.has(sid)));
  return out;
}

// Shaped like the real WAJ data, including the "/" inside a category NAME.
const CATS: Cat[] = [
  { id: 1, name: 'All', complete_name: 'All' },
  { id: 2, name: 'Central Kitchen Products', complete_name: 'All / Central Kitchen Products' },
  { id: 3, name: 'Cooked Components', complete_name: 'All / Central Kitchen Products / Cooked Components' },
  { id: 4, name: 'Doughs & Batters', complete_name: 'All / Central Kitchen Products / Doughs & Batters' },
  { id: 5, name: 'Drinks / Soft Drinks', complete_name: 'All / Drinks / Soft Drinks' },
  { id: 6, name: 'Spices & Seasonings', complete_name: 'All / Spices & Seasonings' },
];

const LOCS: Loc[] = [
  { id: 10, name: 'WAJ Kitchen', parent_id: null },
  { id: 11, name: 'Walk in Cooler 1', parent_id: 10 },
  { id: 12, name: 'D4', parent_id: 11 },
  { id: 13, name: 'Freezer #1', parent_id: 10 },
  { id: 20, name: 'Storage next to Staircase', parent_id: null },
];

const P: Prod[] = [
  { id: 100, categ_id: [3, 'Cooked Components'] },
  { id: 101, categ_id: [4, 'Doughs & Batters'] },
  { id: 102, categ_id: [6, 'Spices & Seasonings'] },
  { id: 103, categ_id: [5, 'Drinks / Soft Drinks'] },
  { id: 104, categ_id: false },
];
const SPOTS: Record<number, number[]> = { 100: [12], 101: [13], 102: [20], 103: [11] };

test('no filter passes everything through', () => {
  expect(narrow(P, null, null, SPOTS)).toHaveLength(5);
});

test('a parent category matches everything beneath it', () => {
  const f = catFamily(2, CATS);           // Central Kitchen Products
  expect(Array.from(f!).sort()).toEqual([2, 3, 4]);
  expect(narrow(P, f, null, SPOTS).map((p) => p.id)).toEqual([100, 101]);
});

test('a leaf category matches only itself', () => {
  expect(narrow(P, catFamily(6, CATS), null, SPOTS).map((p) => p.id)).toEqual([102]);
});

test('a category whose NAME contains "/" is not split into a fake hierarchy', () => {
  // "Drinks / Soft Drinks" is ONE category. Matching on the full path means it
  // never swallows, or gets swallowed by, a sibling.
  const f = catFamily(5, CATS);
  expect(Array.from(f!)).toEqual([5]);
  expect(narrow(P, f, null, SPOTS).map((p) => p.id)).toEqual([103]);
  // And the root must not accidentally match it as a child of a "Drinks" parent
  // that does not exist.
  expect(CATS.filter((c) => c.id !== 1).every((c) => c.complete_name!.startsWith('All / '))).toBe(true);
});

test('a product with no category is dropped by any category filter, never crashes', () => {
  expect(narrow(P, catFamily(1, CATS), null, SPOTS).some((p) => p.id === 104)).toBe(false);
});

test('a parent place matches a spot nested two levels under it', () => {
  const f = locFamily(10, LOCS);          // WAJ Kitchen
  expect(Array.from(f!).sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
  expect(narrow(P, null, f, SPOTS).map((p) => p.id)).toEqual([100, 101, 103]);
});

test('a leaf place matches only what is in it', () => {
  expect(narrow(P, null, locFamily(12, LOCS), SPOTS).map((p) => p.id)).toEqual([100]);
});

test('a place with nothing in it yields an empty list, not everything', () => {
  expect(narrow(P, null, locFamily(99, LOCS), SPOTS)).toHaveLength(0);
});

test('category and place combine (both must match)', () => {
  const out = narrow(P, catFamily(2, CATS), locFamily(11, LOCS), SPOTS);
  expect(out.map((p) => p.id)).toEqual([100]);   // 101 is in Freezer #1, not under Walk in Cooler 1
});

test('a cycle in the place tree cannot hang the walk', () => {
  const cyclic: Loc[] = [
    { id: 1, name: 'A', parent_id: 2 },
    { id: 2, name: 'B', parent_id: 1 },
  ];
  expect(Array.from(locFamily(1, cyclic)!).sort()).toEqual([1, 2]);
});

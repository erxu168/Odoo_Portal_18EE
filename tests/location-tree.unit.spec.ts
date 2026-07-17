import { test, expect } from '@playwright/test';
import { buildLocationTree, nextSortOrder, reorder } from '../src/lib/location-tree';

const rows = [
  { id: 1, parent_id: null, name: 'Kitchen', sort_order: 10 },
  { id: 2, parent_id: 1, name: 'Dry shelf', sort_order: 10 },
  { id: 3, parent_id: 1, name: 'Fridge', sort_order: 20 },
  { id: 4, parent_id: null, name: 'Bar', sort_order: 20 },
] as any;

test('buildLocationTree nests children under parents, sorted by sort_order', () => {
  const tree = buildLocationTree(rows);
  expect(tree.map((n) => n.name)).toEqual(['Kitchen', 'Bar']);
  expect(tree[0].children.map((c) => c.name)).toEqual(['Dry shelf', 'Fridge']);
  expect(tree[1].children).toEqual([]);
});

test('buildLocationTree treats an orphan (missing parent) as a root', () => {
  const orphan = [{ id: 9, parent_id: 999, name: 'Loose', sort_order: 5 }] as any;
  const tree = buildLocationTree(orphan);
  expect(tree.map((n) => n.name)).toEqual(['Loose']);
});

test('nextSortOrder returns max + 10 (10 when empty)', () => {
  expect(nextSortOrder([])).toBe(10);
  expect(nextSortOrder([{ sort_order: 10 }, { sort_order: 30 }])).toBe(40);
});

test('reorder swaps an id with its neighbour in the given direction', () => {
  expect(reorder([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
  expect(reorder([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
  expect(reorder([1, 2, 3], 1, -1)).toEqual([1, 2, 3]); // no-op at edge
  expect(reorder([1, 2, 3], 3, 1)).toEqual([1, 2, 3]); // no-op at edge
});

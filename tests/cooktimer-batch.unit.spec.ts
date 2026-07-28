import { test, expect } from '@playwright/test';
import { splitIntoBatches } from '../src/lib/cooktimer-queue';

// Max batch counts PORTIONS, not order lines: one POS line can be qty 3.
const L = (lineId: number, qty: number, arrivedMs: number) => ({ lineId, qty, arrivedMs });
const ids = (batches: { lineId: number }[][]) => batches.map(b => b.map(l => l.lineId));

test('no limit keeps everything in one batch', () => {
  const lines = [L(1, 1, 10), L(2, 1, 20), L(3, 1, 30)];
  expect(ids(splitIntoBatches(lines, null))).toEqual([[1, 2, 3]]);
  expect(ids(splitIntoBatches(lines, 0))).toEqual([[1, 2, 3]]);
});

test('empty input yields no batches', () => {
  expect(splitIntoBatches([], 6)).toEqual([]);
  expect(splitIntoBatches([], null)).toEqual([]);
});

test('splits by portions once the basket is full', () => {
  // 6 single portions, limit 4 -> 4 + 2
  const lines = [1, 2, 3, 4, 5, 6].map(i => L(i, 1, i * 10));
  expect(ids(splitIntoBatches(lines, 4))).toEqual([[1, 2, 3, 4], [5, 6]]);
});

test('counts quantity, not line count', () => {
  // qty 3 + qty 2 = 5 > limit 4, so the second line opens a new batch.
  expect(ids(splitIntoBatches([L(1, 3, 10), L(2, 2, 20)], 4))).toEqual([[1], [2]]);
  // 3 + 1 fits exactly.
  expect(ids(splitIntoBatches([L(1, 3, 10), L(2, 1, 20)], 4))).toEqual([[1, 2]]);
});

test('a single line larger than the limit gets its own batch (a POS line is atomic)', () => {
  const out = splitIntoBatches([L(1, 10, 10), L(2, 1, 20)], 4);
  expect(ids(out)).toEqual([[1], [2]]);
});

test('always oldest first, and never drops or duplicates a line', () => {
  const lines = [L(3, 1, 300), L(1, 1, 100), L(2, 1, 200), L(4, 1, 400), L(5, 1, 500)];
  const out = splitIntoBatches(lines, 2);
  expect(ids(out)).toEqual([[1, 2], [3, 4], [5]]);
  const flat = out.flat().map(l => l.lineId).sort();
  expect(flat).toEqual([1, 2, 3, 4, 5]);
});

test('a limit of 1 puts every line in its own batch', () => {
  const lines = [1, 2, 3].map(i => L(i, 1, i * 10));
  expect(ids(splitIntoBatches(lines, 1))).toEqual([[1], [2], [3]]);
});

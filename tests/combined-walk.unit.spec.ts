import { test, expect } from '@playwright/test';
import {
  combineLines, ownersOf, combineStops, mergeByProduct, mergeProducts, mergeEntries, walkTitle, lineKey,
  type SessionPayload,
} from '../src/lib/combined-walk';

/**
 * ONE WALK ACROSS SEVERAL COUNTS.
 *
 * The rule that matters: nothing is merged in the database. Every line still
 * belongs to the count it came from, so the books can't be written twice. These
 * tests pin that down — especially who OWNS each line, because that is what
 * decides where a number gets saved.
 */

const daily: SessionPayload = {
  sessionId: 1,
  session: { template_name: 'Daily Count', template_frequency: 'daily' },
  guided: true,
  items: [
    { odoo_product_id: 11, count_location_id: 100 },   // fridge
    { odoo_product_id: 12, count_location_id: 100 },
    { odoo_product_id: 13, count_location_id: 200 },   // freezer
  ],
  stops: [
    { bucket_id: 100, location: { name: 'Drawer D1', kind: 'fridge', photo: null, description: null }, product_ids: [11, 12], status: 'pending', skip_reason: null, ancestors: [{ id: 9, name: 'WAJ Kitchen', kind: 'area' }] },
    { bucket_id: 200, location: { name: 'Freezer', kind: 'freezer', photo: null, description: null }, product_ids: [13], status: 'pending', skip_reason: null, ancestors: [{ id: 9, name: 'WAJ Kitchen', kind: 'area' }] },
  ],
};

const weekly: SessionPayload = {
  sessionId: 2,
  session: { template_name: 'Weekly Deep Count', template_frequency: 'weekly' },
  guided: true,
  items: [
    { odoo_product_id: 21, count_location_id: 100 },   // SAME fridge as the daily
    { odoo_product_id: 12, count_location_id: 100 },   // SAME product+spot as the daily
    { odoo_product_id: 22, count_location_id: 300 },   // a spot only the weekly visits
  ],
  stops: [
    { bucket_id: 100, location: { name: 'Drawer D1', kind: 'fridge', photo: null, description: null }, product_ids: [21, 12], status: 'pending', skip_reason: null, ancestors: [{ id: 9, name: 'WAJ Kitchen', kind: 'area' }] },
    { bucket_id: 300, location: { name: 'Dry store', kind: 'dry', photo: null, description: null }, product_ids: [22], status: 'pending', skip_reason: null, ancestors: [{ id: 9, name: 'WAJ Kitchen', kind: 'area' }] },
  ],
};

test('every line keeps the count it belongs to — that is what stops double writing', () => {
  const lines = combineLines([daily, weekly]);
  // 11,12,13 from daily + 21,22 from weekly, with 12 shared = 5 distinct lines.
  expect(lines).toHaveLength(5);
  expect(ownersOf(lines, 11, 100), 'daily only').toEqual([1]);
  expect(ownersOf(lines, 21, 100), 'weekly only').toEqual([2]);
  expect(ownersOf(lines, 22, 300), 'weekly only').toEqual([2]);
});

test('a product both counts want is asked ONCE and saved to BOTH', () => {
  const lines = combineLines([daily, weekly]);
  const shared = lines.filter((l) => l.pid === 12 && l.loc === 100);
  expect(shared, 'asked once, not twice').toHaveLength(1);
  expect(shared[0].sids.sort(), 'both counts get the answer').toEqual([1, 2]);
});

test('the same spot from two counts becomes ONE stop holding both counts’ products', () => {
  const { stops, guided } = combineStops([daily, weekly]);
  expect(guided).toBe(true);
  expect(stops.map((s) => s.bucket_id), 'each place appears once, in walk order').toEqual([100, 200, 300]);
  const fridge = stops.find((s) => s.bucket_id === 100)!;
  expect(fridge.product_ids.sort((a, b) => a - b), 'no duplicate of the shared product').toEqual([11, 12, 21]);
});

test('a spot is only skipped when EVERY count skipped it', () => {
  const a: SessionPayload = { ...daily, sessionId: 1, items: [], stops: [
    { bucket_id: 100, location: null, product_ids: [1], status: 'skipped', skip_reason: 'locked', ancestors: [] },
  ] };
  const b: SessionPayload = { ...weekly, sessionId: 2, items: [], stops: [
    { bucket_id: 100, location: null, product_ids: [2], status: 'pending', skip_reason: null, ancestors: [] },
  ] };
  const merged = combineStops([a, b]).stops[0];
  expect(merged.status, 'the other count still has work there').toBe('pending');

  const bothSkipped = combineStops([a, { ...b, stops: [{ ...b.stops![0], status: 'skipped', skip_reason: 'locked' }] }]);
  expect(bothSkipped.stops[0].status).toBe('skipped');
});

test('a single count is left exactly as it is', () => {
  const lines = combineLines([daily]);
  expect(lines).toHaveLength(3);
  expect(lines.every((l) => l.sids.length === 1 && l.sids[0] === 1)).toBe(true);
  const { stops } = combineStops([daily]);
  expect(stops).toEqual(daily.stops);
});

test('per-product settings merge without losing anyone’s pack sizes', () => {
  const merged = mergeByProduct<number>([{ 11: 12, 12: 24 }, { 12: 99, 21: 6 }]);
  expect(merged[11]).toBe(12);
  expect(merged[12], 'the first count’s frozen size wins — it is stable').toBe(24);
  expect(merged[21]).toBe(6);
  expect(mergeByProduct([null, undefined, { 1: 'x' }])).toEqual({ 1: 'x' });
});

test('products dedupe by id', () => {
  const out = mergeProducts([[{ id: 1, name: 'a' }, { id: 2, name: 'b' }], [{ id: 2, name: 'b again' }, { id: 3, name: 'c' }]]);
  expect(out.map((p) => p.id)).toEqual([1, 2, 3]);
  expect(out.find((p) => p.id === 2)!.name).toBe('b');
});

test('numbers already entered come back, and a real count beats a blank', () => {
  const merged = mergeEntries([
    { sessionId: 1, entries: [{ product_id: 12, count_location_id: 100, counted_qty: null }] },
    { sessionId: 2, entries: [{ product_id: 12, count_location_id: 100, counted_qty: 7 }] },
  ]);
  expect(merged[lineKey(12, 100)].counted_qty, 'the real number wins over the blank').toBe(7);
});

test('the screen names itself honestly', () => {
  expect(walkTitle([daily]).title).toBe('Daily Count');
  const both = walkTitle([daily, weekly]);
  expect(both.title).toBe('Today’s Count');
  expect(both.subtitle).toBe('Daily Count + Weekly Deep Count');
});

test('nothing open at all is handled without blowing up', () => {
  expect(combineLines([])).toEqual([]);
  expect(combineStops([])).toEqual({ guided: false, stops: [] });
  expect(walkTitle([]).title).toBe('Count');
});

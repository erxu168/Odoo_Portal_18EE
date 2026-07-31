import { test, expect } from '@playwright/test';
import { filterByType } from '../src/lib/inventory-floorplan/marker-presets';

/**
 * The type chips on the plan are a FILTER, not a highlight.
 *
 * Ethan, 2026-07-31, with "Room" picked and fridges/freezers/shelves still all
 * over the plan: "the pills … do not function. i have selected only room and it
 * should just show the rooms without anything else. i should be able to select
 * and deselect multiple pills."
 */

const ANCHORS = [
  { id: 1, typeKey: 'room', label: 'DRY STORAGE' },
  { id: 2, typeKey: 'room', label: 'CHANGING ROOM' },
  { id: 3, typeKey: 'fridge', label: 'Glass door fridge' },
  { id: 4, typeKey: 'shelf', label: 'SLF 9' },
  { id: 5, typeKey: 'freezer', label: 'Chest freezer' },
];

test('no chip picked shows everything — "All" is the resting state', () => {
  expect(filterByType(ANCHORS, [])).toEqual(ANCHORS);
});

test('one chip shows that type and nothing else', () => {
  expect(filterByType(ANCHORS, ['room']).map(a => a.id)).toEqual([1, 2]);
});

test('several chips are OR-ed together — multi-select, not last-one-wins', () => {
  expect(filterByType(ANCHORS, ['fridge', 'freezer']).map(a => a.id)).toEqual([3, 5]);
});

test('a chip for a type nothing on this floor uses empties the map rather than ignoring the pick', () => {
  expect(filterByType(ANCHORS, ['fusebox'])).toEqual([]);
});

test('a duplicated key never duplicates a marker', () => {
  expect(filterByType(ANCHORS, ['room', 'room']).map(a => a.id)).toEqual([1, 2]);
});

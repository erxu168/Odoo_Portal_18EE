import { test, expect } from '@playwright/test';
import { buildGuidedRoute, missedStops, EVERYTHING_ELSE } from '../src/lib/guided-route';

const locations = [
  { id: 1, parent_id: null, name: 'Walk-in', kind: 'fridge', photo: null, description: 'Back wall', sort_order: 10 },
  { id: 2, parent_id: null, name: 'Dry shelf', kind: 'dry', photo: null, description: null, sort_order: 20 },
];

test('groups products by location in walking order, products in shelf order; unplaced go last', () => {
  const { guided, stops } = buildGuidedRoute({
    productIds: [100, 101, 102, 200, 999],
    placements: [
      { odoo_product_id: 101, count_location_id: 1, shelf_sort: 20 },
      { odoo_product_id: 100, count_location_id: 1, shelf_sort: 10 },
      { odoo_product_id: 200, count_location_id: 2, shelf_sort: 10 },
      { odoo_product_id: 102, count_location_id: 1, shelf_sort: 30 },
      // 999 has no placement -> Everything else
    ],
    locations,
    statuses: [],
  });
  expect(guided).toBe(true);
  expect(stops.map((s) => s.bucket_id)).toEqual([1, 2, EVERYTHING_ELSE]);
  expect(stops[0].product_ids).toEqual([100, 101, 102]); // shelf order within Walk-in
  expect(stops[1].product_ids).toEqual([200]);
  expect(stops[2].location).toBeNull();
  expect(stops[2].product_ids).toEqual([999]);
});

test('nested locations walk depth-first (area -> its shelves), not by flat sort_order', () => {
  // Area A (sort 10) has shelves A1(10), A2(20); Area B (sort 20) has shelf B1(10).
  // Flat sort by sort_order would wrongly order A1, B1, A2. DFS gives A1, A2, B1.
  const nested = [
    { id: 1, parent_id: null, name: 'Area A', kind: 'area', photo: null, description: null, sort_order: 10 },
    { id: 2, parent_id: null, name: 'Area B', kind: 'area', photo: null, description: null, sort_order: 20 },
    { id: 3, parent_id: 1, name: 'A1', kind: 'zone', photo: null, description: null, sort_order: 10 },
    { id: 4, parent_id: 1, name: 'A2', kind: 'zone', photo: null, description: null, sort_order: 20 },
    { id: 5, parent_id: 2, name: 'B1', kind: 'zone', photo: null, description: null, sort_order: 10 },
  ];
  const { stops } = buildGuidedRoute({
    productIds: [300, 400, 500],
    placements: [
      { odoo_product_id: 400, count_location_id: 4, shelf_sort: 10 },
      { odoo_product_id: 500, count_location_id: 5, shelf_sort: 10 },
      { odoo_product_id: 300, count_location_id: 3, shelf_sort: 10 },
    ],
    locations: nested,
    statuses: [],
  });
  expect(stops.map((s) => s.bucket_id)).toEqual([3, 4, 5]);
});

test('a product in two locations is placed at its PRIMARY (earliest walk) stop only', () => {
  const { stops } = buildGuidedRoute({
    productIds: [100],
    placements: [
      { odoo_product_id: 100, count_location_id: 2, shelf_sort: 5 },
      { odoo_product_id: 100, count_location_id: 1, shelf_sort: 5 }, // loc 1 walks first
    ],
    locations,
    statuses: [],
  });
  expect(stops).toHaveLength(1);
  expect(stops[0].bucket_id).toBe(1);
  expect(stops[0].product_ids).toEqual([100]);
});

test('all products unplaced => not guided, single Everything-else stop', () => {
  const { guided, stops } = buildGuidedRoute({
    productIds: [1, 2], placements: [], locations, statuses: [],
  });
  expect(guided).toBe(false);
  expect(stops).toHaveLength(1);
  expect(stops[0].bucket_id).toBe(EVERYTHING_ELSE);
});

test('statuses attach; missedStops returns only pending stops that have products', () => {
  const { stops } = buildGuidedRoute({
    productIds: [100, 200, 999],
    placements: [
      { odoo_product_id: 100, count_location_id: 1, shelf_sort: 10 },
      { odoo_product_id: 200, count_location_id: 2, shelf_sort: 10 },
    ],
    locations,
    statuses: [
      { count_location_id: 1, status: 'counted', skip_reason: null },
      { count_location_id: 2, status: 'skipped', skip_reason: 'locked' },
      // Everything else (999) left pending
    ],
  });
  expect(stops[0].status).toBe('counted');
  expect(stops[1].status).toBe('skipped');
  expect(stops[1].skip_reason).toBe('locked');
  const missed = missedStops(stops);
  expect(missed.map((s) => s.bucket_id)).toEqual([EVERYTHING_ELSE]);
});

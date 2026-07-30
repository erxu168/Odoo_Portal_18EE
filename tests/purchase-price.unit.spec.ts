import { test, expect } from '@playwright/test';
import { indexSupplierPrices, resolveBuyPrice, priceSourceLabel } from '../src/lib/purchase-price';

/**
 * The order guide showed Odoo's list_price — the price you SELL at. Almost no
 * product here has one, so Odoo's default of 1.00 stood in and the guide read
 * €1.00 for essentially everything. The real numbers were one model away: on
 * staging, 515 of 601 catalog products have a supplier price and only 8 have a
 * cost. Verified in the live guide, which held prices of 1.00 and 0.00.
 *
 * Figures below are real staging rows.
 */
const KAHLER = 41;
const ASIAMOIN = 55;

// Thyme: Kahler quote 7.30, our cost 19.80, "selling price" 1.00 (Odoo default).
const THYME = { id: 956, product_tmpl_id: 900 as unknown as [number, string], standard_price: 19.80 };
const ROWS = [
  { product_id: false as const, product_tmpl_id: 900, partner_id: [KAHLER, 'Kahler Gewürze GmbH'] as [number, string], price: 7.30 },
  { product_id: false as const, product_tmpl_id: 900, partner_id: [ASIAMOIN, 'Asiamoin.com'] as [number, string], price: 9.10 },
];

test('THE BUG: the price comes from the SUPPLIER, never from list_price', () => {
  const idx = indexSupplierPrices(ROWS, KAHLER);
  const r = resolveBuyPrice(THYME, idx);
  expect(r.price).toBe(7.30);
  expect(r.source).toBe('supplier');
  expect(r.supplier_name).toMatch(/Kahler/);
});

test('each supplier is quoted their OWN price, not the first one found', () => {
  expect(resolveBuyPrice(THYME, indexSupplierPrices(ROWS, ASIAMOIN)).price).toBe(9.10);
  expect(resolveBuyPrice(THYME, indexSupplierPrices(ROWS, KAHLER)).price).toBe(7.30);
});

test('a supplierinfo row on the TEMPLATE is found — that is how most are attached', () => {
  // Both rows above are template-level. Indexing only by variant would miss
  // essentially every price in this database.
  const idx = indexSupplierPrices(ROWS, KAHLER);
  expect(idx.byTemplate.size).toBe(1);
  expect(resolveBuyPrice(THYME, idx).source).toBe('supplier');
});

test('a variant-specific price wins over the template one', () => {
  const rows = [...ROWS, { product_id: 956, product_tmpl_id: false as const, partner_id: [KAHLER, 'Kahler'] as [number, string], price: 6.50 }];
  expect(resolveBuyPrice(THYME, indexSupplierPrices(rows, KAHLER)).price).toBe(6.50);
});

test('quantity breaks collapse to the cheapest, since the guide shows one price', () => {
  const rows = [
    { product_id: false as const, product_tmpl_id: 900, partner_id: [KAHLER, 'K'] as [number, string], price: 7.30, min_qty: 1 },
    { product_id: false as const, product_tmpl_id: 900, partner_id: [KAHLER, 'K'] as [number, string], price: 6.80, min_qty: 10 },
  ];
  expect(resolveBuyPrice(THYME, indexSupplierPrices(rows, KAHLER)).price).toBe(6.80);
});

test('no supplier price falls back to OUR COST, and says so', () => {
  const r = resolveBuyPrice(THYME, indexSupplierPrices([], KAHLER));
  expect(r.price).toBe(19.80);
  expect(r.source).toBe('cost');
  expect(priceSourceLabel(r.source)).toMatch(/no supplier price yet/);
});

test('nothing at all is zero AND labelled unknown — never a confident 0.00', () => {
  const bare = { id: 1, product_tmpl_id: 2 as unknown as [number, string], standard_price: 0 };
  const r = resolveBuyPrice(bare, indexSupplierPrices([], KAHLER));
  expect(r.price).toBe(0);
  expect(r.source).toBe('none');
  expect(priceSourceLabel(r.source)).toMatch(/no price yet/);
});

test('a supplierinfo price of 0 is "not priced", not "free"', () => {
  const rows = [{ product_id: false as const, product_tmpl_id: 900, partner_id: [KAHLER, 'K'] as [number, string], price: 0 }];
  // Falls through to cost rather than quoting zero.
  expect(resolveBuyPrice(THYME, indexSupplierPrices(rows, KAHLER)).source).toBe('cost');
});

test('another supplier’s price is never quoted as this one’s', () => {
  const r = resolveBuyPrice(THYME, indexSupplierPrices(ROWS, 999));
  expect(r.source).toBe('cost');
  expect(r.price).toBe(19.80);
});

test('with no supplier named, any supplier price is better than the selling price', () => {
  // The search is also used outside a guide. Cheapest available beats 1.00.
  const r = resolveBuyPrice(THYME, indexSupplierPrices(ROWS));
  expect(r.source).toBe('supplier');
  expect(r.price).toBe(7.30);
});

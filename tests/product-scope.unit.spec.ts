import { test, expect } from '@playwright/test';
import { catalogDomain, CATALOG_FIELDS, SLIM_CATALOG_FIELDS } from '../src/lib/product-scope';

/**
 * The Products dashboard prints counts of the catalog and then opens it. The
 * only thing stopping a tile reading 600 above a list showing 583 is that both
 * ask the same question — so these pin the question.
 *
 * They are cheap and they are here because the failure they catch is silent:
 * nobody notices a scope change until a manager reports "the numbers are wrong"
 * weeks later, by which point the commit that did it is long forgotten.
 */

const has = (domain: unknown[], field: string, op: string, value: unknown) =>
  domain.some((c) => Array.isArray(c) && c[0] === field && c[1] === op && c[2] === value);

test('the catalog is physical goods only — never services or combos', () => {
  // Odoo 18 renamed this: type='consu' is "Goods". A service has no stock and
  // must never appear on a counting screen.
  expect(has(catalogDomain(), 'type', '=', 'consu')).toBe(true);
});

test('till products are excluded by default, and only by explicit request', () => {
  // Menu items are maintained in POS. The catalog is what you buy, hold, count.
  expect(has(catalogDomain(), 'available_in_pos', '=', false)).toBe(true);
  expect(has(catalogDomain({ includePos: true }), 'available_in_pos', '=', false)).toBe(false);
});

test('archived products are a deliberate choice, never the default', () => {
  expect(has(catalogDomain(), 'active', '=', true)).toBe(true);
  expect(has(catalogDomain({ activeOnly: false }), 'active', '=', true)).toBe(false);
});

test('is_storable is read on every catalog screen', () => {
  // THE reason this field is in the shared list. Odoo 18 keeps "is it a
  // physical good?" (type) apart from "do we track how much we hold?"
  // (is_storable, default FALSE). A product with it off holds no stock figure,
  // so an approved count has nowhere to write — the portal cannot warn about
  // what it never reads, and 541 products sat in that state unnoticed.
  expect(CATALOG_FIELDS).toContain('is_storable');
  expect(SLIM_CATALOG_FIELDS).toContain('is_storable');
});

test('the slim field set stays a strict subset — same question, less payload', () => {
  // If slim ever gained a field the full read lacks, the dashboard would be
  // counting something the list cannot show.
  for (const f of SLIM_CATALOG_FIELDS) {
    expect(CATALOG_FIELDS, `slim field "${f}" must also be read by the full catalog`).toContain(f);
  }
  expect(SLIM_CATALOG_FIELDS.length).toBeLessThan(CATALOG_FIELDS.length);
});

test('slim carries what the dashboard counts, and nothing it does not', () => {
  // active — the catalog lists live products, so the counts must match that.
  // id — to subtract the ones that already have a picture.
  expect(SLIM_CATALOG_FIELDS).toContain('active');
  expect(SLIM_CATALOG_FIELDS).toContain('id');
  // Descriptions are HTML and by far the heaviest field; several hundred of
  // them were being downloaded to print three numbers.
  expect(SLIM_CATALOG_FIELDS).not.toContain('description');
});

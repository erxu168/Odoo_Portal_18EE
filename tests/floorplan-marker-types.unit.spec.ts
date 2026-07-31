import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-floorplan-mk-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import { getDb } from '../src/lib/db';
import { initInventoryTables, createCountLocation, setProductsSpotsBulk } from '../src/lib/inventory-db';
import {
  upsertLocationKind, markerOnlyKinds, setLocationKindMarkerOnly, markerConversionBlockers,
} from '../src/lib/inventory-floorplan/db';
import { getTypeRegistry } from '../src/lib/inventory-floorplan/manifest';

/**
 * Ethan, 2026-07-31: "the central gas shut off valve is not a location but just
 * a location marker … we need to create an extra type that does not hold any
 * products but are the actual product itself … for these items, we do not need
 * any nesting nor should it be displayed inside the location picker for product
 * location."
 */

const CO = 300000 + Math.floor(Math.random() * 200000);

test.beforeAll(() => { initInventoryTables(); });

test('a type can be marked as a marker, and says so in the registry', () => {
  upsertLocationKind(CO, 'main gas shutoff', { label: 'Main Gas Shutoff', icon: '⚠️', shape: 'triangle', markerOnly: 1 });
  upsertLocationKind(CO, 'beer keg fridge', { label: 'Beer Keg Fridge', icon: '🍺' });

  const types = getTypeRegistry(CO);
  expect(types.find(t => t.key === 'main gas shutoff')).toMatchObject({ markerOnly: true, custom: true });
  expect(types.find(t => t.key === 'beer keg fridge')).toMatchObject({ markerOnly: false });
  // Storage built-ins are unaffected.
  expect(types.find(t => t.key === 'shelf')?.markerOnly).toBe(false);
  expect(types.find(t => t.key === 'fridge')?.markerOnly).toBe(false);
});

test('utility is a marker out of the box — a fuse box is not a shelf', () => {
  const fresh = CO + 1;
  expect(getTypeRegistry(fresh).find(t => t.key === 'utility')?.markerOnly).toBe(true);
  expect(markerOnlyKinds(fresh)).toContain('utility');
});

test('a restaurant can overrule the built-in and use Utility as storage', () => {
  const co = CO + 2;
  upsertLocationKind(co, 'utility', { label: 'Utility', markerOnly: 0 });
  expect(getTypeRegistry(co).find(t => t.key === 'utility')?.markerOnly).toBe(false);
  expect(markerOnlyKinds(co)).not.toContain('utility');
});

test('markerOnlyKinds lists exactly what the picker must drop', () => {
  const kinds = markerOnlyKinds(CO);
  expect(kinds.sort()).toEqual(['main gas shutoff', 'utility']);
});

test('the flag flips both ways — anything created can be edited', () => {
  const id = upsertLocationKind(CO, 'first aid kit', { label: 'First Aid Kit', icon: '🩹' });
  expect(markerOnlyKinds(CO)).not.toContain('first aid kit');
  setLocationKindMarkerOnly(id, CO, true);
  expect(markerOnlyKinds(CO)).toContain('first aid kit');
  setLocationKindMarkerOnly(id, CO, false);
  expect(markerOnlyKinds(CO)).not.toContain('first aid kit');
});

test('one restaurant’s marker types never leak into another', () => {
  const other = CO + 3;
  upsertLocationKind(other, 'main gas shutoff', { label: 'Main Gas Shutoff' });
  expect(markerOnlyKinds(other)).toEqual(['utility']);
  expect(getDb().prepare('SELECT COUNT(*) n FROM location_kinds WHERE marker_only = 1').get()).toBeTruthy();
});


/* ---- the invariants, not just the labelling ----------------------------- */

const CO2 = CO + 50;

const place = (name: string, kind: string, parent: number | null = null) => createCountLocation({
  parent_id: parent, company_id: CO2, name, kind,
  description: null, photo: null, odoo_location_id: null, created_by: 1,
});

test('products cannot be assigned to a marker, whichever screen asks', () => {
  upsertLocationKind(CO2, 'gas valve', { label: 'Gas Valve', markerOnly: 1 });
  const valve = place('MAIN VALVE', 'gas valve');
  const shelf = place('SLF A', 'shelf');

  expect(() => setProductsSpotsBulk(CO2, [{ product_id: 900, spot_ids: [valve] }]))
    .toThrow(/marker/i);
  // …and the shelf next to it still works, so the guard is not a blanket refusal.
  expect(() => setProductsSpotsBulk(CO2, [{ product_id: 900, spot_ids: [shelf] }])).not.toThrow();
});

test('a placement that already exists survives — the rule bites on NEW ones only', () => {
  const shelf = place('SLF B', 'shelf');
  setProductsSpotsBulk(CO2, [{ product_id: 901, spot_ids: [shelf] }]);
  // The type becomes a marker after the fact (direct write — the API refuses this).
  const kindId = upsertLocationKind(CO2, 'shelf', { label: 'Shelf' });
  setLocationKindMarkerOnly(kindId, CO2, true);
  expect(() => setProductsSpotsBulk(CO2, [{ product_id: 901, spot_ids: [shelf] }])).not.toThrow();
  setLocationKindMarkerOnly(kindId, CO2, false);
});

test('nothing can be created inside a marker', () => {
  const valve = place('SECOND VALVE', 'gas valve');
  expect(() => place('D1', 'drawer', valve)).toThrow(/marker/i);
  const fridge = place('FRIDGE A', 'fridge');
  expect(() => place('D1', 'drawer', fridge)).not.toThrow();
});

test('conversion is blocked while locations of that type are in use', () => {
  upsertLocationKind(CO2, 'chest freezer', { label: 'Chest Freezer' });
  const freezer = place('CHEST 1', 'chest freezer');
  expect(markerConversionBlockers(CO2, 'chest freezer')).toMatchObject({ locations: 1, products: 0, children: 0 });

  setProductsSpotsBulk(CO2, [{ product_id: 902, spot_ids: [freezer] }]);
  expect(markerConversionBlockers(CO2, 'chest freezer')).toMatchObject({ products: 1 });

  // A type nobody uses converts freely.
  upsertLocationKind(CO2, 'spare marker', { label: 'Spare Marker' });
  expect(markerConversionBlockers(CO2, 'spare marker')).toMatchObject({ locations: 0, products: 0, children: 0 });
});

test('hiding a built-in does not silently cancel its marker default', () => {
  const co = CO2 + 1;
  // This is what "remove Utility from my library" writes: a row with no opinion
  // about marker_only. NULL must keep meaning "inherit".
  upsertLocationKind(co, 'utility', { label: 'Utility', hidden: 1 });
  expect(markerOnlyKinds(co)).toContain('utility');
});

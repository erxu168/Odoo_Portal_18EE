import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-floorplan-man-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import { getDb } from '../src/lib/db';
import { initInventoryTables, createCountLocation } from '../src/lib/inventory-db';
import {
  createFloor, createFloorDocument, createRevision, insertCandidates, updateAnchorPin,
} from '../src/lib/inventory-floorplan/db';
import { publishRevision } from '../src/lib/inventory-floorplan/publish';
import { buildManifest, getTypeRegistry, placedProductIds } from '../src/lib/inventory-floorplan/manifest';
import type { Pt } from '../src/lib/inventory-floorplan/types';

/**
 * The one payload the staff map lives on. Seeds a published floor through the
 * REAL publish transaction (not hand-inserted anchors) so the manifest test
 * breaks if publish and manifest ever drift apart.
 */

const CO = 500000 + Math.floor(Math.random() * 400000); // unique per run: the worker scratch DB persists across runs
const ACTOR = { userId: 1, name: 'Test Admin' };

function box(x: number, y: number): Pt[] {
  return [{ x, y }, { x: x + 0.02, y }, { x: x + 0.02, y: y + 0.01 }, { x, y: y + 0.01 }];
}

let floorId = 0;

test.beforeAll(() => {
  initInventoryTables();
  const docId = createFloorDocument({
    company_id: CO, original_filename: 'v13.pdf', pdf_relpath: 'floorplans/d.pdf',
    sha256: 'm1', byte_size: 10, page_count: 1, uploaded_by: 1,
  });
  floorId = createFloor({ company_id: CO, name: 'Basement', code: '-1F', created_by: 1 });
  const revId = createRevision({
    floor_id: floorId, document_id: docId, source_page_number: 1,
    page_width: 841, page_height: 595, page_rotation: 0,
    raster_relpath: 'floorplans/r.webp', raster_mime: 'image/webp',
    raster_width: 2807, raster_height: 1985, raster_bytes: 1, uploaded_by: 1,
  });
  insertCandidates(revId, [
    { item_index: 0, raw_text: 'Dry Room', normalized_text: 'DRY ROOM', polygon: box(0.4, 0.2), rotation_degrees: 0, proposed_kind: 'room' },
    { item_index: 1, raw_text: 'SLF 1', normalized_text: 'SLF 1', polygon: box(0.42, 0.3), rotation_degrees: 0, proposed_kind: 'spot', proposed_type: 'shelf', proposed_room: 'Dry Room' },
    { item_index: 2, raw_text: 'Fuse Box B', normalized_text: 'FUSE BOX B', polygon: box(0.3, 0.6), rotation_degrees: 0, proposed_kind: 'spot', proposed_type: 'utility', proposed_room: null },
  ]);
  getDb().prepare("UPDATE inventory_floor_candidates SET disposition='create' WHERE revision_id=?").run(revId);
  const res = publishRevision(revId, ACTOR, 1);
  if (!res.ok) throw new Error('seed publish failed: ' + JSON.stringify(res));
});

test('manifest carries floors, anchors with paths, and a places index', () => {
  const m = buildManifest(CO, { products: [] });
  expect(m.floors.length).toBe(1);
  expect(m.floors[0].revision).not.toBeNull();
  expect(m.floors[0].revision!.rasterUrl).toContain('/assets/');

  const anchors = m.anchors[floorId];
  expect(anchors.length).toBe(3);
  const slf = anchors.find(a => a.label === 'SLF 1')!;
  expect(slf.typeKey).toBe('shelf');
  expect(slf.room).toBe('Dry Room');
  expect(slf.path).toBe('Dry Room · SLF 1');
  expect(slf.display).toBe('overlay');

  const buckets = m.places.map(p => p.bucket).sort();
  expect(buckets).toEqual(['room', 'spot', 'utility']);
  const fuse = m.places.find(p => p.label === 'FUSE BOX B')!;
  expect(fuse.bucket).toBe('utility');
});

test('product index joins placements with injected Odoo data; missing products drop out', () => {
  const m0 = buildManifest(CO, { products: [] });
  const slfId = m0.places.find(p => p.label === 'SLF 1')!.locationId;
  getDb().prepare('INSERT OR REPLACE INTO product_locations (odoo_product_id, count_location_id, shelf_sort) VALUES (?,?,0)').run(901, slfId);
  getDb().prepare('INSERT OR REPLACE INTO product_locations (odoo_product_id, count_location_id, shelf_sort) VALUES (?,?,1)').run(902, slfId);

  expect(placedProductIds(CO).sort()).toEqual([901, 902]);

  const m = buildManifest(CO, {
    products: [{ id: 901, name: 'Paprika edelsüß 1kg', category: 'Spices' }], // 902 vanished from Odoo
  });
  expect(m.products.length).toBe(1);
  expect(m.products[0]).toMatchObject({ id: 901, name: 'Paprika edelsüß 1kg', category: 'Spices', locationIds: [slfId] });
  expect(m.productsUnavailable).toBe(false);
});

test('Odoo unavailable is a flagged state, never an empty lie', () => {
  const m = buildManifest(CO, { products: null });
  expect(m.productsUnavailable).toBe(true);
  expect(m.products).toEqual([]);
});

test('type registry = built-ins + company customs; a company row OVERRIDES a built-in', () => {
  // Ethan's rule (2026-07-31): the library is HIS. A company row for a
  // built-in key customises that built-in (label/icon/colour/shape/layer) or
  // hides it — it never duplicates it and is never ignored.
  getDb().prepare(
    "INSERT OR IGNORE INTO location_kinds (company_id, kind, label, sort_order, icon, color) VALUES (?,?,?,0,?,?)",
  ).run(CO, 'utility', 'Old Custom Utility', '🔧', '#334455');
  getDb().prepare(
    "INSERT OR IGNORE INTO location_kinds (company_id, kind, label, sort_order, icon, color) VALUES (?,?,?,1,?,?)",
  ).run(CO, 'winecellar', 'Wine Cellar', '🍷', '#7C2D12');
  getDb().prepare(
    "INSERT OR IGNORE INTO location_kinds (company_id, kind, label, sort_order, icon, color) VALUES (?,?,?,2,?,NULL)",
  ).run(CO, 'firstaid', 'First Aid', '🚑');

  const types = getTypeRegistry(CO);
  expect(types.find(t => t.key === 'shelf')).toMatchObject({ label: 'Shelf', custom: false, color: '#16A34A' });
  expect(types.find(t => t.key === 'floorspace')).toMatchObject({ label: 'Floor space', custom: false, color: '#3B82F6' });
  expect(types.find(t => t.key === 'cabinet')).toMatchObject({ label: 'Cabinet', custom: false, color: '#8B5CF6' });
  expect(types.filter(t => t.key === 'utility').length).toBe(1);       // never duplicated
  expect(types.find(t => t.key === 'utility')).toMatchObject({
    custom: false,             // still a built-in key
    color: '#334455',          // …wearing the company's colour
    label: 'Old Custom Utility',
    icon: '🔧',
  });
  expect(types.find(t => t.key === 'winecellar')).toMatchObject({ label: 'Wine Cellar', custom: true, color: '#7C2D12' });
  expect(types.find(t => t.key === 'firstaid')).toMatchObject({ label: 'First Aid', icon: '🚑', custom: true, color: '#64748B' });
});

test('archived spots vanish from anchors and places', () => {
  const m0 = buildManifest(CO, { products: [] });
  const fuseId = m0.places.find(p => p.label === 'FUSE BOX B')!.locationId;
  getDb().prepare('UPDATE count_locations SET active = 0 WHERE id = ?').run(fuseId);
  const m = buildManifest(CO, { products: [] });
  expect(m.anchors[floorId].find(a => a.locationId === fuseId)).toBeUndefined();
  expect(m.places.find(p => p.locationId === fuseId)).toBeUndefined();
});

test('hiding a built-in removes it from the library without touching the key', () => {
  const before = getTypeRegistry(CO).find(t => t.key === 'shelf');
  expect(before?.hidden).toBeFalsy();
  getDb().prepare(
    "INSERT INTO location_kinds (company_id, kind, label, icon, sort_order, hidden) VALUES (?,?,?,?,90,1)",
  ).run(CO, 'shelf', 'Shelf', '🗄️');
  const hidden = getTypeRegistry(CO).find(t => t.key === 'shelf');
  expect(hidden?.hidden).toBe(true);
  expect(getTypeRegistry(CO).filter(t => t.key === 'shelf').length).toBe(1);
});

/**
 * Leader line — an icon pulled out of a crowded room.
 *
 * The whole design rests on one invariant: pin_cx/pin_cy move where the icon
 * is DRAWN and never touch cx/cy, which is the spot itself and the thing the
 * rest of inventory reads. If that ever slips, dragging an icon for looks
 * would quietly relocate real stock.
 */
test('pulling an icon out moves the ICON, never the spot', () => {
  const m0 = buildManifest(CO, { products: [] });
  const a0 = m0.anchors[floorId].find(a => a.label === 'SLF 1')!;
  expect(a0.pinCx).toBeNull();
  expect(a0.pinCy).toBeNull();

  // Seeded anchors come from detected labels, so they publish as 'overlay'
  // shapes. Only a MARKER can be pulled out, so make this one a marker first.
  getDb().prepare("UPDATE inventory_floor_anchors SET display='pin' WHERE id = ?").run(a0.id);

  expect(updateAnchorPin(a0.id, { x: 0.77, y: 0.11 })).toBe(true);

  const a1 = buildManifest(CO, { products: [] }).anchors[floorId].find(a => a.id === a0.id)!;
  expect(a1.pinCx).toBeCloseTo(0.77);
  expect(a1.pinCy).toBeCloseTo(0.11);
  expect(a1.cx).toBeCloseTo(a0.cx);   // the spot has NOT moved
  expect(a1.cy).toBeCloseTo(a0.cy);
  expect(a1.polygon).toEqual(a0.polygon);

  // Snap back clears the pull-out and still leaves the spot untouched.
  expect(updateAnchorPin(a0.id, null)).toBe(true);
  const a2 = buildManifest(CO, { products: [] }).anchors[floorId].find(a => a.id === a0.id)!;
  expect(a2.pinCx).toBeNull();
  expect(a2.pinCy).toBeNull();
  expect(a2.cx).toBeCloseTo(a0.cx);
  expect(a2.cy).toBeCloseTo(a0.cy);
});

test('half a coordinate pair is not a position — the manifest reports no pull-out', () => {
  const m0 = buildManifest(CO, { products: [] });
  // FUSE BOX B is archived by an earlier test, so use the shelf — the test
  // above leaves it snapped back, so it starts from a clean null pair.
  const a0 = m0.anchors[floorId].find(a => a.label === 'SLF 1')!;
  // Only one of the two written: a torn write, or an older row. Drawing an
  // arrow to a guessed coordinate would be worse than drawing none.
  getDb().prepare('UPDATE inventory_floor_anchors SET pin_cx = 0.5, pin_cy = NULL WHERE id = ?').run(a0.id);
  const a1 = buildManifest(CO, { products: [] }).anchors[floorId].find(a => a.id === a0.id)!;
  expect(a1.pinCx).toBeNull();
  expect(a1.pinCy).toBeNull();
});

test('a write that hits no row reports failure instead of a false success', () => {
  expect(updateAnchorPin(99999999, { x: 0.5, y: 0.5 })).toBe(false);
  expect(updateAnchorPin(99999999, null)).toBe(false);
});

test('a shape is not a marker — an overlay anchor refuses a pull-out', () => {
  const m0 = buildManifest(CO, { products: [] });
  // 'Dry Room' publishes as an overlay: a shape on the plan, with no icon to
  // move. Enforced in the DB helper, not only in the route, so no code path
  // can leave a pull-out coordinate on something that cannot render one.
  const room = m0.anchors[floorId].find(a => a.display === 'overlay')!;
  expect(room).toBeTruthy();
  expect(updateAnchorPin(room.id, { x: 0.6, y: 0.6 })).toBe(false);
  const after = buildManifest(CO, { products: [] }).anchors[floorId].find(a => a.id === room.id)!;
  expect(after.pinCx).toBeNull();
  expect(after.pinCy).toBeNull();
});

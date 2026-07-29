import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-floorplan-man-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import { getDb } from '../src/lib/db';
import { initInventoryTables, createCountLocation } from '../src/lib/inventory-db';
import {
  createFloor, createFloorDocument, createRevision, insertCandidates,
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

test('type registry = built-ins + company customs with color fallback', () => {
  getDb().prepare(
    "INSERT OR IGNORE INTO location_kinds (company_id, kind, label, sort_order, icon, color) VALUES (?,?,?,0,?,?)",
  ).run(CO, 'utility', 'Utility', '🔧', '#334455');
  getDb().prepare(
    "INSERT OR IGNORE INTO location_kinds (company_id, kind, label, sort_order, icon, color) VALUES (?,?,?,1,?,NULL)",
  ).run(CO, 'firstaid', 'First Aid', '🚑');

  const types = getTypeRegistry(CO);
  expect(types.find(t => t.key === 'shelf')).toMatchObject({ label: 'Shelf', custom: false, color: '#16A34A' });
  expect(types.find(t => t.key === 'utility')).toMatchObject({ label: 'Utility', custom: true, color: '#334455' });
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

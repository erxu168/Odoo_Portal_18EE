import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-floorplan-del-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import { getDb } from '../src/lib/db';
import { initInventoryTables, createCountLocation } from '../src/lib/inventory-db';
import {
  createFloor, createFloorDocument, createRevision, createAnchor,
  getSpotUsage, deleteSpotWithAnchors,
} from '../src/lib/inventory-floorplan/db';

/**
 * Ethan, 2026-07-31: "i dragged shelf 20 into the dry storage area and then
 * deleted it. now i dragged again into the space and the system tells me that
 * shelf 20 already exist even though it had been deleted."
 *
 * Removing a MARKER always left the SPOT behind, so the name stayed taken. A
 * spot nothing has touched can now be deleted outright — and one with contents
 * or history must still refuse, because those rows point at it by id.
 */

const CO = 700000 + Math.floor(Math.random() * 200000);
let revId = 0;
let floorId = 0;

const spot = (name: string, parent: number | null = null) => createCountLocation({
  parent_id: parent, company_id: CO, name, kind: 'shelf',
  description: null, photo: null, odoo_location_id: null, created_by: 1,
});

const marker = (locationId: number) => createAnchor({
  revision_id: revId, count_location_id: locationId,
  polygon: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }],
  cx: 0.15, cy: 0.15, label: 'SLF', display: 'pin', is_primary: true, created_by: 1,
});

test.beforeAll(() => {
  initInventoryTables();
  const docId = createFloorDocument({
    company_id: CO, original_filename: 'p.pdf', pdf_relpath: 'floorplans/p.pdf',
    sha256: 'del1', byte_size: 10, page_count: 1, uploaded_by: 1,
  });
  floorId = createFloor({ company_id: CO, name: 'Basement', code: '-1F', created_by: 1 });
  revId = createRevision({
    floor_id: floorId, document_id: docId, source_page_number: 1,
    page_width: 841, page_height: 595, page_rotation: 0,
    raster_relpath: 'floorplans/p.webp', raster_mime: 'image/webp',
    raster_width: 2807, raster_height: 1985, raster_bytes: 1, uploaded_by: 1,
  });
  // A real floor is PUBLISHED and points at its live revision; the "older
  // plan" rule only means anything against that shape.
  getDb().prepare("UPDATE inventory_floor_revisions SET status = 'published' WHERE id = ?").run(revId);
  getDb().prepare('UPDATE inventory_floors SET current_revision_id = ? WHERE id = ?').run(revId, floorId);
});

test('a spot just placed by mistake is empty, and deleting it takes its marker with it', () => {
  const id = spot('SLF 20');
  const anchorId = marker(id);
  expect(getSpotUsage(id)).toMatchObject({ children: 0, products: 0, history: 0, empty: true });

  expect(deleteSpotWithAnchors(id, CO)).toBe(true);
  expect(getDb().prepare('SELECT 1 FROM count_locations WHERE id = ?').get(id)).toBeUndefined();
  expect(getDb().prepare('SELECT 1 FROM inventory_floor_anchors WHERE id = ?').get(anchorId)).toBeUndefined();
  // The name is free again — which is the whole point of the bug report.
  expect(() => spot('SLF 20')).not.toThrow();
});

test('a spot with something inside it refuses to be deleted', () => {
  const fridge = spot('COUNTERTOP FRIDGE 9');
  spot('D1', fridge);
  expect(getSpotUsage(fridge)).toMatchObject({ children: 1, empty: false });
  expect(deleteSpotWithAnchors(fridge, CO)).toBe(false);
  expect(getDb().prepare('SELECT 1 FROM count_locations WHERE id = ?').get(fridge)).toBeTruthy();
});

test('a spot with products on it refuses to be deleted', () => {
  const id = spot('SLF 31');
  getDb().prepare('INSERT INTO product_locations (odoo_product_id, count_location_id, shelf_sort) VALUES (?,?,0)').run(4242, id);
  expect(getSpotUsage(id)).toMatchObject({ products: 1, empty: false });
  expect(deleteSpotWithAnchors(id, CO)).toBe(false);
});

test('a spot with counting history refuses to be deleted', () => {
  const id = spot('SLF 32');
  const db = getDb();
  // count_entries hangs off a real session (foreign key), so seed the chain.
  const templateId = Number(db.prepare(
    "INSERT INTO counting_templates (name, location_id, company_id, created_by, created_at, updated_at) VALUES ('T', ?, ?, 1, '2026-07-31', '2026-07-31')",
  ).run(id, CO).lastInsertRowid);
  const sessionId = Number(db.prepare(
    "INSERT INTO counting_sessions (template_id, scheduled_date, location_id, company_id, created_at) VALUES (?, '2026-07-31', ?, ?, '2026-07-31')",
  ).run(templateId, id, CO).lastInsertRowid);
  db.prepare(
    'INSERT INTO count_entries (session_id, product_id, count_location_id, counted_qty, counted_by, counted_at) VALUES (?,?,?,?,?,?)',
  ).run(sessionId, 4242, id, 3, 1, '2026-07-31 10:00:00');
  expect(getSpotUsage(id)).toMatchObject({ history: 1, empty: false });
  expect(deleteSpotWithAnchors(id, CO)).toBe(false);
  expect(getDb().prepare('SELECT 1 FROM count_locations WHERE id = ?').get(id)).toBeTruthy();
});

test('a spot that appeared on an OLDER published plan is history, not deletable', () => {
  const id = spot('SLF 40');
  const db = getDb();
  // Same floor, a second revision that has since taken over as current.
  const docId = createFloorDocument({
    company_id: CO, original_filename: 'v2.pdf', pdf_relpath: 'floorplans/v2.pdf',
    sha256: 'del2', byte_size: 10, page_count: 1, uploaded_by: 1,
  });
  const newerRev = createRevision({
    floor_id: floorId, document_id: docId, source_page_number: 1,
    page_width: 841, page_height: 595, page_rotation: 0,
    raster_relpath: 'floorplans/v2.webp', raster_mime: 'image/webp',
    raster_width: 2807, raster_height: 1985, raster_bytes: 1, uploaded_by: 1,
  });
  // The REAL lifecycle: publishing marks the previous revision 'superseded'.
  db.prepare("UPDATE inventory_floor_revisions SET status = 'published' WHERE id = ?").run(newerRev);
  db.prepare("UPDATE inventory_floor_revisions SET status = 'superseded' WHERE id = ?").run(revId);
  db.prepare('UPDATE inventory_floors SET current_revision_id = ? WHERE id = ?').run(newerRev, floorId);
  marker(id); // marker sits on the OLD, superseded revision

  expect(getSpotUsage(id)).toMatchObject({ pastPlans: 1, empty: false });
  expect(deleteSpotWithAnchors(id, CO)).toBe(false);
  expect(getDb().prepare('SELECT 1 FROM count_locations WHERE id = ?').get(id)).toBeTruthy();

  db.prepare("UPDATE inventory_floor_revisions SET status = 'published' WHERE id = ?").run(revId);
  db.prepare('UPDATE inventory_floors SET current_revision_id = ? WHERE id = ?').run(revId, floorId);
});

test('a spot on an ARCHIVED floor is history too', () => {
  const id = spot('SLF 42');
  const db = getDb();
  marker(id);
  db.prepare('UPDATE inventory_floors SET active = 0 WHERE id = ?').run(floorId);
  expect(getSpotUsage(id)).toMatchObject({ pastPlans: 1, empty: false });
  expect(deleteSpotWithAnchors(id, CO)).toBe(false);
  db.prepare('UPDATE inventory_floors SET active = 1 WHERE id = ?').run(floorId);
});

test('a review candidate still linked to the spot blocks the delete', () => {
  const id = spot('SLF 41');
  getDb().prepare(`
    INSERT INTO inventory_floor_candidates
      (revision_id, item_index, raw_text, normalized_text, polygon, rotation_degrees, disposition, linked_location_id)
    VALUES (?, 0, 'SLF 41', 'SLF 41', '[]', 0, 'link', ?)
  `).run(revId, id);
  expect(getSpotUsage(id).empty).toBe(false);
  expect(deleteSpotWithAnchors(id, CO)).toBe(false);
});

test('another restaurant cannot delete this restaurant’s spot', () => {
  const id = spot('SLF 33');
  expect(deleteSpotWithAnchors(id, CO + 1)).toBe(false);
  expect(getDb().prepare('SELECT 1 FROM count_locations WHERE id = ?').get(id)).toBeTruthy();
});

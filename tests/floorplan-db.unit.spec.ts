import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Floorplan schema + CRUD against the REAL db layer (PORTAL_DB_PATH scratch
 * file), not a re-implementation. Pins the revision model invariants that the
 * publish flow (Task 4) builds on: draft-only mutation targets, one primary
 * anchor per location per revision, and code-level existence guards (the
 * schema declares no FOREIGN KEYs, matching inventory-db.ts).
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-floorplan-db-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import { getDb } from '../src/lib/db';
import {
  initFloorplanTables,
  createFloor,
  listFloors,
  updateFloor,
  createFloorDocument,
  createRevision,
  getRevision,
  insertCandidates,
  listCandidates,
  createAnchor,
  listAnchors,
  getPrimaryAnchorForLocation,
} from '../src/lib/inventory-floorplan/db';

const CO = 500000 + Math.floor(Math.random() * 400000); // unique per run: the worker scratch DB persists across runs
let seq = 0; // unique floor names — every test shares one scratch DB file

function seedRevision() {
  seq += 1;
  const docId = createFloorDocument({
    company_id: CO, original_filename: 'SSK96 Basement Floor Plan v1.3.pdf',
    pdf_relpath: 'floorplans/doc_test.pdf', sha256: 'abc', byte_size: 1234, page_count: 1,
    uploaded_by: 1,
  });
  const floorId = createFloor({ company_id: CO, name: `Basement ${seq}`, code: '-1F', created_by: 1 });
  const revId = createRevision({
    floor_id: floorId, document_id: docId, source_page_number: 1,
    page_width: 841.89, page_height: 595.276, page_rotation: 0,
    raster_relpath: 'floorplans/rev_test.webp', raster_mime: 'image/webp',
    raster_width: 2807, raster_height: 1985, raster_bytes: 645840, uploaded_by: 1,
  });
  return { docId, floorId, revId };
}

test('init is idempotent and creates the five floorplan tables', () => {
  initFloorplanTables();
  initFloorplanTables();
  const names = getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'inventory_floor%' ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);
  expect(names).toEqual([
    'inventory_floor_anchors',
    'inventory_floor_candidates',
    'inventory_floor_documents',
    'inventory_floor_revisions',
  ].concat(['inventory_floors']).sort());
});

test('location_kinds gains the color column (guarded migration)', () => {
  initFloorplanTables();
  const cols = getDb().prepare('PRAGMA table_info(location_kinds)').all().map((c) => (c as { name: string }).name);
  expect(cols).toContain('color');
  expect(cols).toContain('icon');
});

test('floor names are unique per company, case-insensitive; other companies unaffected', () => {
  initFloorplanTables();
  createFloor({ company_id: CO, name: 'Ground', code: 'EG', created_by: 1 });
  expect(() => createFloor({ company_id: CO, name: 'ground', code: 'EG2', created_by: 1 })).toThrow();
  expect(() => createFloor({ company_id: CO + 1, name: 'Ground', code: 'EG', created_by: 1 })).not.toThrow();
});

test('document → floor → revision → candidates → anchors round-trip', () => {
  initFloorplanTables();
  const { floorId, revId } = seedRevision();

  const rev = getRevision(revId)!;
  expect(rev.status).toBe('draft');
  expect(rev.revision_no).toBe(1);
  expect(rev.floor_id).toBe(floorId);

  insertCandidates(revId, [
    { item_index: 0, raw_text: 'SLF 1', normalized_text: 'SLF 1',
      polygon: [{ x: 0.1, y: 0.2 }, { x: 0.12, y: 0.2 }, { x: 0.12, y: 0.22 }, { x: 0.1, y: 0.22 }],
      rotation_degrees: 0, proposed_kind: 'spot', proposed_type: 'shelf' },
    { item_index: 1, raw_text: 'Naming System:', normalized_text: 'NAMING SYSTEM:',
      polygon: [{ x: 0.8, y: 0.7 }, { x: 0.9, y: 0.7 }, { x: 0.9, y: 0.72 }, { x: 0.8, y: 0.72 }],
      rotation_degrees: 0, proposed_kind: 'other' },
  ]);
  const cands = listCandidates(revId);
  expect(cands.length).toBe(2);
  expect(cands[0].disposition).toBe('pending');
  expect(cands[0].polygon.length).toBe(4);

  const anchorId = createAnchor({
    revision_id: revId, count_location_id: 42, source_candidate_id: cands[0].id,
    polygon: cands[0].polygon, cx: 0.11, cy: 0.21, label: 'SLF 1', display: 'overlay',
    is_primary: true, created_by: 1,
  });
  expect(anchorId).toBeGreaterThan(0);
  const anchors = listAnchors(revId);
  expect(anchors.length).toBe(1);
  expect(anchors[0].count_location_id).toBe(42);
});

test('anchors and revisions guard against missing parents (no silent orphans)', () => {
  initFloorplanTables();
  const { revId } = seedRevision();
  expect(() =>
    createAnchor({
      revision_id: 999999, count_location_id: 1,
      polygon: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0, y: 0.1 }],
      cx: 0.05, cy: 0.05, label: 'X', display: 'pin', is_primary: true, created_by: 1,
    })
  ).toThrow(/revision/i);
  expect(() =>
    createRevision({
      floor_id: 999999, document_id: 1, source_page_number: 1,
      page_width: 100, page_height: 100, page_rotation: 0,
      raster_relpath: 'x.webp', raster_mime: 'image/webp',
      raster_width: 10, raster_height: 10, raster_bytes: 1, uploaded_by: 1,
    })
  ).toThrow(/floor/i);
  // second primary anchor for the same location+revision is refused by the partial unique index
  createAnchor({
    revision_id: revId, count_location_id: 7,
    polygon: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0, y: 0.1 }],
    cx: 0.05, cy: 0.05, label: 'A', display: 'overlay', is_primary: true, created_by: 1,
  });
  expect(() =>
    createAnchor({
      revision_id: revId, count_location_id: 7,
      polygon: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }, { x: 0.2, y: 0.3 }],
      cx: 0.25, cy: 0.25, label: 'A2', display: 'overlay', is_primary: true, created_by: 1,
    })
  ).toThrow();
});

test('primary anchor lookup sees only published revisions of active floors', () => {
  initFloorplanTables();
  const { floorId, revId } = seedRevision();
  createAnchor({
    revision_id: revId, count_location_id: 555,
    polygon: [{ x: 0.4, y: 0.4 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.5 }, { x: 0.4, y: 0.5 }],
    cx: 0.45, cy: 0.45, label: 'REF 1', display: 'overlay', is_primary: true, created_by: 1,
  });
  expect(getPrimaryAnchorForLocation(555)).toBeNull(); // draft revision → invisible

  getDb().prepare("UPDATE inventory_floor_revisions SET status='published' WHERE id=?").run(revId);
  getDb().prepare('UPDATE inventory_floors SET current_revision_id=? WHERE id=?').run(revId, floorId);
  const hit = getPrimaryAnchorForLocation(555)!;
  expect(hit.floor_id).toBe(floorId);
  expect(hit.revision_id).toBe(revId);
  expect(hit.cx).toBeCloseTo(0.45);

  updateFloor(floorId, { active: 0 });
  expect(getPrimaryAnchorForLocation(555)).toBeNull(); // archived floor → invisible
  expect(listFloors([CO]).find((f) => f.id === floorId)).toBeUndefined();
});

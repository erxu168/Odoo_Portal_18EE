import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-floorplan-pub-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import { getDb } from '../src/lib/db';
import { initInventoryTables, createCountLocation, listCountLocations } from '../src/lib/inventory-db';
import {
  createFloor, createFloorDocument, createRevision, insertCandidates, listAnchors, getRevision,
} from '../src/lib/inventory-floorplan/db';
import { publishRevision } from '../src/lib/inventory-floorplan/publish';
import type { Pt } from '../src/lib/inventory-floorplan/types';

/**
 * The publish transaction: reviewed candidates become count_locations + anchors
 * atomically, or NOTHING happens. These are the invariants the whole module
 * hangs on — a half-published plan or a silently duplicated spot would poison
 * real inventory data.
 */

const CO = 3;
const ACTOR = { userId: 1, name: 'Test Admin' };
let seq = 0;

function box(x: number, y: number): Pt[] {
  return [{ x, y }, { x: x + 0.02, y }, { x: x + 0.02, y: y + 0.01 }, { x, y: y + 0.01 }];
}

function seed(candidates: Parameters<typeof insertCandidates>[1]) {
  seq += 1;
  const docId = createFloorDocument({
    company_id: CO, original_filename: `plan${seq}.pdf`, pdf_relpath: `floorplans/d${seq}.pdf`,
    sha256: `sha${seq}`, byte_size: 10, page_count: 1, uploaded_by: 1,
  });
  const floorId = createFloor({ company_id: CO, name: `Floor ${seq}`, code: `-${seq}F`, created_by: 1 });
  const revId = createRevision({
    floor_id: floorId, document_id: docId, source_page_number: 1,
    page_width: 841, page_height: 595, page_rotation: 0,
    raster_relpath: `floorplans/r${seq}.webp`, raster_mime: 'image/webp',
    raster_width: 2807, raster_height: 1985, raster_bytes: 1, uploaded_by: 1,
  });
  insertCandidates(revId, candidates);
  return { docId, floorId, revId };
}

const roomCand = (i: number, name: string) => ({
  item_index: i, raw_text: name, normalized_text: name.toUpperCase(),
  polygon: box(0.1 + i * 0.05, 0.1), rotation_degrees: 0, proposed_kind: 'room' as const,
});
const spotCand = (i: number, code: string, type: string, room: string) => ({
  item_index: i, raw_text: code, normalized_text: code, polygon: box(0.1 + i * 0.05, 0.3),
  rotation_degrees: 0, proposed_kind: 'spot' as const, proposed_type: type, proposed_room: room,
});

function setDispositions(revId: number, to: 'create') {
  getDb().prepare("UPDATE inventory_floor_candidates SET disposition=? WHERE revision_id=? AND disposition='pending'").run(to, revId);
}

test.beforeAll(() => { initInventoryTables(); });

test('happy path: rooms + spots + anchors created atomically, revision published', () => {
  const { floorId, revId } = seed([
    roomCand(0, 'Dry Room'),
    roomCand(1, 'Fridge Room'),
    spotCand(2, 'SLF 1', 'shelf', 'Dry Room'),
    spotCand(3, 'SLF 2', 'shelf', 'Dry Room'),
    spotCand(4, 'REF 1', 'fridge', 'Fridge Room'),
    { item_index: 5, raw_text: 'Naming System:', normalized_text: 'NAMING SYSTEM:', polygon: box(0.9, 0.9), rotation_degrees: 0, proposed_kind: 'other' as const },
  ]);
  setDispositions(revId, 'create'); // 'other' stays kept? — no: mark it ignored below
  getDb().prepare("UPDATE inventory_floor_candidates SET disposition='ignored', ignored_reason='legend' WHERE revision_id=? AND proposed_kind='other'").run(revId);

  const res = publishRevision(revId, ACTOR, 1);
  expect(res).toEqual({ ok: true, createdRooms: 2, createdSpots: 3, linked: 0, anchors: 5 });

  const locs = listCountLocations(CO) as Array<{ id: number; name: string; parent_id: number | null; kind: string }>;
  const dry = locs.find(l => l.name === 'Dry Room')!;
  expect(dry.kind).toBe('room');
  const slf1 = locs.find(l => l.name === 'SLF 1' && l.parent_id === dry.id)!;
  expect(slf1.kind).toBe('shelf');

  expect(listAnchors(revId).length).toBe(5);
  const rev = getRevision(revId)!;
  expect(rev.status).toBe('published');
  expect(rev.version).toBe(2); // optimistic version bumped
  expect(getDb().prepare('SELECT current_revision_id AS c FROM inventory_floors WHERE id=?').get(floorId)).toEqual({ c: revId });
});

test('publishing twice is refused; wrong version is refused', () => {
  const { revId } = seed([roomCand(0, 'Heating Room')]);
  setDispositions(revId, 'create');
  expect(publishRevision(revId, ACTOR, 99).ok).toBe(false);
  expect((publishRevision(revId, ACTOR, 99) as { code: string }).code).toBe('conflict');
  expect(publishRevision(revId, ACTOR, 1).ok).toBe(true);
  const again = publishRevision(revId, ACTOR, 2);
  expect(again.ok).toBe(false);
  expect((again as { code: string }).code).toBe('not_draft');
});

test('a single bad coordinate aborts the WHOLE publish (nothing created)', () => {
  const before = (listCountLocations(CO) as unknown[]).length;
  const { revId } = seed([
    roomCand(0, 'Good Room'),
    { item_index: 1, raw_text: 'SLF 9', normalized_text: 'SLF 9', polygon: [{ x: 1.5, y: 0.2 }, { x: 1.6, y: 0.2 }, { x: 1.6, y: 0.3 }, { x: 1.5, y: 0.3 }], rotation_degrees: 0, proposed_kind: 'spot' as const, proposed_type: 'shelf', proposed_room: 'Good Room' },
  ]);
  setDispositions(revId, 'create');
  const res = publishRevision(revId, ACTOR, 1);
  expect(res.ok).toBe(false);
  expect((res as { code: string }).code).toBe('bad_coords');
  expect((listCountLocations(CO) as unknown[]).length).toBe(before); // no partial writes
  expect(listAnchors(revId).length).toBe(0);
  expect(getRevision(revId)!.status).toBe('draft');
});

test('linking a spot from another restaurant is refused', () => {
  const foreign = createCountLocation({
    parent_id: null, company_id: 5, name: 'WAJ Shelf', kind: 'shelf',
    description: null, photo: null, odoo_location_id: null, created_by: 1,
  });
  const { revId } = seed([
    { item_index: 0, raw_text: 'SLF 1', normalized_text: 'SLF 1', polygon: box(0.2, 0.2), rotation_degrees: 0, proposed_kind: 'spot' as const, proposed_type: 'shelf', proposed_room: null },
  ]);
  getDb().prepare("UPDATE inventory_floor_candidates SET disposition='linked', linked_location_id=? WHERE revision_id=?").run(foreign, revId);
  const res = publishRevision(revId, ACTOR, 1);
  expect(res.ok).toBe(false);
  expect((res as { code: string }).code).toBe('company_mismatch');
});

test('same-room duplicate codes block publish; cross-room duplicates are fine', () => {
  const { revId } = seed([
    roomCand(0, 'Room A'),
    roomCand(1, 'Room B'),
    spotCand(2, 'SLF 1', 'shelf', 'Room A'),
    spotCand(3, 'SLF 1', 'shelf', 'Room A'),
  ]);
  setDispositions(revId, 'create');
  const res = publishRevision(revId, ACTOR, 1);
  expect(res.ok).toBe(false);
  expect((res as { code: string }).code).toBe('duplicate_codes');

  const ok = seed([
    roomCand(0, 'Room C'),
    roomCand(1, 'Room D'),
    spotCand(2, 'SLF 1', 'shelf', 'Room C'),
    spotCand(3, 'SLF 1', 'shelf', 'Room D'),
  ]);
  setDispositions(ok.revId, 'create');
  expect(publishRevision(ok.revId, ACTOR, 1).ok).toBe(true);
});

test('creating a code that already exists in that room tells the reviewer to link', () => {
  const { revId, floorId } = seed([
    roomCand(0, 'Room E'),
    spotCand(1, 'REF 1', 'fridge', 'Room E'),
  ]);
  setDispositions(revId, 'create');
  expect(publishRevision(revId, ACTOR, 1).ok).toBe(true);

  // second revision of the SAME floor tries to create REF 1 in Room E again
  const docId = createFloorDocument({
    company_id: CO, original_filename: 'v2.pdf', pdf_relpath: 'floorplans/v2.pdf',
    sha256: 'v2', byte_size: 10, page_count: 1, uploaded_by: 1,
  });
  const rev2 = createRevision({
    floor_id: floorId, document_id: docId, source_page_number: 1,
    page_width: 841, page_height: 595, page_rotation: 0,
    raster_relpath: 'floorplans/v2.webp', raster_mime: 'image/webp',
    raster_width: 100, raster_height: 100, raster_bytes: 1, uploaded_by: 1,
  });
  insertCandidates(rev2, [spotCand(0, 'REF 1', 'fridge', 'Room E')]);
  setDispositions(rev2, 'create');
  const res = publishRevision(rev2, ACTOR, 1);
  expect(res.ok).toBe(false);
  expect((res as { code: string; detail?: string }).code).toBe('duplicate_codes');
  expect((res as { detail?: string }).detail).toContain('link');
});

test('a new revision supersedes the previous published one', () => {
  const { floorId, revId } = seed([roomCand(0, 'Room F')]);
  setDispositions(revId, 'create');
  expect(publishRevision(revId, ACTOR, 1).ok).toBe(true);

  const docId = createFloorDocument({
    company_id: CO, original_filename: 'v3.pdf', pdf_relpath: 'floorplans/v3.pdf',
    sha256: 'v3', byte_size: 10, page_count: 1, uploaded_by: 1,
  });
  const rev2 = createRevision({
    floor_id: floorId, document_id: docId, source_page_number: 1,
    page_width: 841, page_height: 595, page_rotation: 0,
    raster_relpath: 'floorplans/v3.webp', raster_mime: 'image/webp',
    raster_width: 100, raster_height: 100, raster_bytes: 1, uploaded_by: 1,
  });
  insertCandidates(rev2, [{ item_index: 0, raw_text: 'Room F', normalized_text: 'ROOM F', polygon: box(0.4, 0.4), rotation_degrees: 0, proposed_kind: 'room' as const }]);
  setDispositions(rev2, 'create');
  const res = publishRevision(rev2, ACTOR, 1);
  expect(res).toMatchObject({ ok: true, createdRooms: 0 }); // Room F exists → reused, not duplicated
  expect(getRevision(revId)!.status).toBe('superseded');
  expect(getRevision(rev2)!.status).toBe('published');
  expect(getDb().prepare('SELECT current_revision_id AS c FROM inventory_floors WHERE id=?').get(floorId)).toEqual({ c: rev2 });
});

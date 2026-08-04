import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * "Where is this?" — the crosshair on a counting stop.
 *
 * Ethan, 2026-08-04, looking at Jerk Chicken kept in a drawer AND a glass-door
 * fridge: "when I press the crosshair, where will it lead me to?"
 *
 * Today: nowhere. Only ROOMS are drawn on his plan (44 of them) and only the
 * exact spot was looked up, so a drawer — which never gets its own pin — found
 * nothing. Walking UP the tree is the honest answer: the drawer is inside the
 * fridge, the fridge is in the room, and the room IS on the plan.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-findspot-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { getDb } = require('../src/lib/db');
const inv = require('../src/lib/inventory-db');
const fp = require('../src/lib/inventory-floorplan/db');

const CO = 6;
const NOW = '2026-08-04T05:00:00.000Z';
let ROOM = 0, FRIDGE = 0, DRAWER = 0, LONELY = 0, FLOOR = 0, REV = 0;

function mkLoc(name: string, parent: number | null): number {
  return getDb().prepare(
    `INSERT INTO count_locations (name, kind, company_id, parent_id, active, created_by, created_at, updated_at)
     VALUES (?, 'drawer', ?, ?, 1, 1, ?, ?)`,
  ).run(name, CO, parent, NOW, NOW).lastInsertRowid as number;
}

test.beforeAll(() => {
  inv.initInventoryTables();
  fp.initFloorplanTables();
  const db = getDb();

  ROOM = mkLoc('FRIDGE ROOM', null);
  FRIDGE = mkLoc('Fridge with glass door #2', ROOM);
  DRAWER = mkLoc('D4', FRIDGE);
  LONELY = mkLoc('A shelf nobody drew', null);

  FLOOR = db.prepare(
    `INSERT INTO inventory_floors (company_id, name, active, created_at) VALUES (?, 'Ssam Basement', 1, ?)`,
  ).run(CO, NOW).lastInsertRowid as number;
  REV = db.prepare(
    `INSERT INTO inventory_floor_revisions
       (floor_id, document_id, revision_no, page_width, page_height, raster_relpath,
        raster_mime, raster_width, raster_height, raster_bytes, status)
     VALUES (?, 1, 1, 800, 600, 'x.png', 'image/png', 800, 600, 1, 'published')`,
  ).run(FLOOR).lastInsertRowid as number;
  db.prepare('UPDATE inventory_floors SET current_revision_id = ? WHERE id = ?').run(REV, FLOOR);
  // ONLY the room is drawn — exactly like the real plan.
  db.prepare(
    `INSERT INTO inventory_floor_anchors (revision_id, count_location_id, polygon, cx, cy, label, is_primary)
     VALUES (?, ?, '[]', 120, 240, 'FRIDGE ROOM', 1)`,
  ).run(REV, ROOM);
});

test('a room that IS drawn answers for itself, with no detour', () => {
  const got = fp.findAnchorForLocationOrAncestor(ROOM);
  expect(got).toBeTruthy();
  expect(got.via, 'it is the room itself, so nothing to explain').toBeNull();
  expect([got.cx, got.cy]).toEqual([120, 240]);
});

test('THE CASE: a drawer finds the room it is in', () => {
  const got = fp.findAnchorForLocationOrAncestor(DRAWER);
  expect(got, 'a drawer has no pin of its own — that is normal').toBeTruthy();
  expect(got.via.id, 'it points at the room').toBe(ROOM);
  expect(got.via.name).toBe('FRIDGE ROOM');
  expect([got.cx, got.cy]).toEqual([120, 240]);
});

test('the fridge in between finds it too', () => {
  expect(fp.findAnchorForLocationOrAncestor(FRIDGE).via.id).toBe(ROOM);
});

test('a spot with nothing drawn anywhere above it says so, rather than guessing', () => {
  expect(fp.findAnchorForLocationOrAncestor(LONELY)).toBeNull();
});

test('an unpublished plan does not count as drawn', () => {
  const db = getDb();
  db.prepare("UPDATE inventory_floor_revisions SET status = 'draft' WHERE id = ?").run(REV);
  expect(fp.findAnchorForLocationOrAncestor(DRAWER), 'a draft is not on the wall').toBeNull();
  db.prepare("UPDATE inventory_floor_revisions SET status = 'published' WHERE id = ?").run(REV);
});

test('a loop in the tree cannot hang the lookup', () => {
  const a = mkLoc('Loop A', null);
  const b = mkLoc('Loop B', a);
  getDb().prepare('UPDATE count_locations SET parent_id = ? WHERE id = ?').run(b, a);
  expect(fp.findAnchorForLocationOrAncestor(a)).toBeNull();
});

test('the walk NEVER leaves the restaurant it started in', () => {
  // parent_id carries no company constraint, so one bad row could otherwise
  // send a WAJ drawer flying to a pin on another restaurant's plan. Access was
  // only ever checked on the spot that was ASKED about.
  const foreignRoom = getDb().prepare(
    `INSERT INTO count_locations (name, kind, company_id, parent_id, active, created_by, created_at, updated_at)
     VALUES ('SOMEONE ELSE ROOM', 'drawer', 99, NULL, 1, 1, ?, ?)`,
  ).run(NOW, NOW).lastInsertRowid as number;
  getDb().prepare(
    `INSERT INTO inventory_floor_anchors (revision_id, count_location_id, polygon, cx, cy, label, is_primary)
     VALUES (?, ?, '[]', 999, 999, 'SOMEONE ELSE', 1)`,
  ).run(REV, foreignRoom);
  // Our spot is parented into the other restaurant's room.
  const stray = mkLoc('Stray shelf', foreignRoom);
  expect(fp.findAnchorForLocationOrAncestor(stray), 'must not cross restaurants').toBeNull();
});

test('an anchor pointing at ANOTHER restaurant’s floor is not honoured', () => {
  // The parent chain was guarded, but an anchor's FLOOR was not: a location
  // attached to another company's revision returned that foreign floor and its
  // coordinates. Guarding only half a boundary is not guarding it. (Codex.)
  const db = getDb();
  const otherFloor = db.prepare(
    `INSERT INTO inventory_floors (company_id, name, active, created_at) VALUES (99, 'Someone else', 1, ?)`,
  ).run(NOW).lastInsertRowid as number;
  const otherRev = db.prepare(
    `INSERT INTO inventory_floor_revisions
       (floor_id, document_id, revision_no, page_width, page_height, raster_relpath,
        raster_mime, raster_width, raster_height, raster_bytes, status)
     VALUES (?, 1, 1, 800, 600, 'y.png', 'image/png', 800, 600, 1, 'published')`,
  ).run(otherFloor).lastInsertRowid as number;
  db.prepare('UPDATE inventory_floors SET current_revision_id = ? WHERE id = ?').run(otherRev, otherFloor);

  const mine = mkLoc('My shelf, wrongly pinned', null);   // company 6
  db.prepare(
    `INSERT INTO inventory_floor_anchors (revision_id, count_location_id, polygon, cx, cy, label, is_primary)
     VALUES (?, ?, '[]', 5, 5, 'WRONG', 1)`,
  ).run(otherRev, mine);

  expect(fp.findAnchorForLocationOrAncestor(mine), 'a pin on another restaurant’s plan is not ours').toBeNull();
});

test('a deep but valid hierarchy is still found, not called missing', () => {
  // A fixed shallow cap would turn a real answer into "not on the plan".
  let parent: number | null = ROOM;
  for (let i = 0; i < 25; i++) parent = mkLoc(`level ${i}`, parent);
  const got = fp.findAnchorForLocationOrAncestor(parent!);
  expect(got, '25 levels down must still find the room').toBeTruthy();
  expect(got.via.id).toBe(ROOM);
});

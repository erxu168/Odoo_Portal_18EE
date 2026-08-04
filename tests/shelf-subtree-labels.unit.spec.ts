import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * "Labels for everything here" on a fridge must include its DRAWERS.
 *
 * Nobody thinks of a drawer as a separate errand — you label the fridge, which
 * means the things in its drawers too. Ethan's real hierarchy is three deep:
 * area → unit → drawer.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-subtree-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { getDb } = require('../src/lib/db');
const db = require('../src/lib/inventory-db');

const CO = 6;
const NOW = '2026-08-04T03:00:00.000Z';
let AREA = 0, FRIDGE = 0, D1 = 0, D2 = 0, ELSEWHERE = 0;

function place(productId: number, locId: number, sort = 0) {
  getDb().prepare(
    'INSERT OR IGNORE INTO product_locations (odoo_product_id, count_location_id, shelf_sort) VALUES (?, ?, ?)',
  ).run(productId, locId, sort);
}

function mkLoc(name: string, parent: number | null): number {
  const r = getDb().prepare(
    `INSERT INTO count_locations (name, kind, company_id, parent_id, active, created_by, created_at, updated_at)
     VALUES (?, 'drawer', ?, ?, 1, 1, ?, ?)`,
  ).run(name, CO, parent, NOW, NOW);
  return r.lastInsertRowid as number;
}

test.beforeAll(() => {
  db.initInventoryTables();
  AREA = mkLoc('WAJ Kitchen', null);
  FRIDGE = mkLoc('Countertop fridge', AREA);
  D1 = mkLoc('D1', FRIDGE);
  D2 = mkLoc('D2', FRIDGE);
  ELSEWHERE = mkLoc('Walk in Cooler', AREA);
  // 11 sits ON the fridge, 12 and 13 in its drawers, 99 somewhere else entirely.
  place(11, FRIDGE); place(12, D1); place(13, D2); place(99, ELSEWHERE);
});

test('a fridge means its drawers too', () => {
  const got = db.getPlacementsInSubtree(FRIDGE).map((p: any) => p.odoo_product_id).sort();
  expect(got, 'the fridge itself AND both drawers').toEqual([11, 12, 13]);
});

test('it never reaches a sibling shelf', () => {
  const got = db.getPlacementsInSubtree(FRIDGE).map((p: any) => p.odoo_product_id);
  expect(got, 'the walk-in is not inside the fridge').not.toContain(99);
});

test('the whole area gathers everything beneath it', () => {
  const got = db.getPlacementsInSubtree(AREA).map((p: any) => p.odoo_product_id).sort();
  expect(got).toEqual([11, 12, 13, 99]);
});

test('a leaf drawer returns just its own', () => {
  expect(db.getPlacementsInSubtree(D1).map((p: any) => p.odoo_product_id)).toEqual([12]);
});

test('a spot holding nothing returns nothing, not an error', () => {
  expect(db.getPlacementsInSubtree(mkLoc('Empty shelf', AREA))).toEqual([]);
});

test('labels come out grouped by shelf — how a person with a roll works', () => {
  const spots = db.getPlacementsInSubtree(FRIDGE).map((p: any) => p.count_location_id);
  expect(spots, 'never interleaved between drawers').toEqual([...spots].sort((a, b) => a - b));
});

test('a cycle in the tree cannot hang the query', () => {
  // Defensive: parent_id is not constrained, so bad data must not spin forever.
  const a = mkLoc('Loop A', null);
  const b = mkLoc('Loop B', a);
  getDb().prepare('UPDATE count_locations SET parent_id = ? WHERE id = ?').run(b, a);
  place(77, b);
  expect(db.getPlacementsInSubtree(a).map((p: any) => p.odoo_product_id)).toEqual([77]);
});

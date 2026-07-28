import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * What a product delete is allowed to destroy.
 *
 * The rule: a number a person typed on a shelf is work, and work blocks the
 * delete whatever state its count is in. The guard used to look only at
 * submitted and approved counts while the cleanup deleted entries out of
 * pending, in_progress and rejected ones — so a manager could delete a product
 * mid-count and wipe what a staff member had just entered, silently.
 *
 * A frozen snapshot line is NOT work: in an untouched count it only records
 * that the product was on the list, so it blocks only once the count is
 * submitted or approved. A REJECTED quick count is not work either — a manager
 * has already thrown it away, and nothing in the portal can clear it, so
 * blocking on one would make the product undeletable forever.
 *
 * These drive the REAL describeCountWorkForProduct against a throwaway database
 * (PORTAL_DB_PATH), not a copy of its SQL — a test that mirrors the code it
 * checks stays green while the code drifts, which is the one failure it exists
 * to catch.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-delete-guard-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

// Imported AFTER the env var is set — the module opens the database on the
// first call, so a static import would bind the real data/portal.db first.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { getDb } = require('../src/lib/db');
const { initInventoryTables, describeCountWorkForProduct, countLockedLinesForProduct } =
  require('../src/lib/inventory-db');

const P = 990555;

test.beforeAll(() => { initInventoryTables(); });
test.afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp dir */ } });

test.beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM count_entries WHERE product_id >= 990000').run();
  db.prepare('DELETE FROM quick_counts WHERE product_id >= 990000').run();
  db.prepare('DELETE FROM session_count_items WHERE odoo_product_id >= 990000').run();
  db.prepare('DELETE FROM counting_sessions WHERE id >= 990000').run();
  db.prepare('DELETE FROM counting_templates WHERE id >= 990000').run();
});

// Every required column of the REAL schema — the reason a hand-written mini
// schema is not good enough: it silently omits what production enforces.
const NOW = '2026-07-28T09:00:00.000Z';
function list(id: number, name: string) {
  getDb().prepare(`INSERT INTO counting_templates
    (id, name, location_id, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, name, 1, 1, NOW, NOW);
}
function session(id: number, status: string, templateId: number) {
  getDb().prepare(`INSERT INTO counting_sessions
    (id, template_id, scheduled_date, location_id, status, created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, templateId, '2026-07-28', 1, status, NOW);
}
/**
 * One entry per (session, spot, product) — the real table enforces it. Two
 * entries on one list therefore means the product was counted in two places,
 * which is exactly what multi-spot counting produces.
 */
function entry(sessionId: number, productId = P, spot = 0) {
  getDb().prepare(`INSERT INTO count_entries
    (session_id, product_id, count_location_id, counted_qty, counted_by, counted_at) VALUES (?,?,?,?,?,?)`)
    .run(sessionId, productId, spot, 6, 1, NOW);
}
function quick(status: string, productId = P) {
  getDb().prepare(`INSERT INTO quick_counts
    (product_id, location_id, counted_qty, counted_by, submitted_at, status) VALUES (?,?,?,?,?,?)`)
    .run(productId, 1, 3, 1, NOW, status);
}
function frozen(sessionId: number, productId = P) {
  getDb().prepare(`INSERT INTO session_count_items
    (session_id, odoo_product_id, count_location_id) VALUES (?,?,?)`)
    .run(sessionId, productId, 0);
}

test('a product nobody has counted can be deleted', () => {
  expect(describeCountWorkForProduct(P).total).toBe(0);
  expect(countLockedLinesForProduct(P)).toBe(0);
});

test('THE BUG: an entry in a count still being counted blocks the delete', () => {
  list(990001, 'Daily Count');
  session(990001, 'in_progress', 990001);
  entry(990001);
  const w = describeCountWorkForProduct(P);
  expect(w.total).toBe(1);
  expect(w.where[0]).toBe('1 entry on "Daily Count" (still being counted)');
});

test('an entry in a count sent back to be redone blocks it too', () => {
  list(990002, 'Weekly Deep Count');
  session(990002, 'rejected', 990002);
  entry(990002);
  expect(describeCountWorkForProduct(P).where[0]).toContain('sent back to be redone');
});

test('an entry in a pending count blocks it — someone typed a number', () => {
  list(990003, 'Fridge Check'); session(990003, 'pending', 990003);
  entry(990003);
  expect(describeCountWorkForProduct(P).total).toBe(1);
});

test('submitted and approved still block, as before', () => {
  for (const [i, st] of ['submitted', 'approved'].entries()) {
    const db = getDb();
    db.prepare('DELETE FROM count_entries WHERE product_id >= 990000').run();
    db.prepare('DELETE FROM counting_sessions WHERE id >= 990000').run();
    list(990010 + i, `List ${st}`); session(990010 + i, st, 990010 + i);
    entry(990010 + i);
    expect(describeCountWorkForProduct(P).total, st).toBeGreaterThan(0);
  }
});

test('a pending quick count blocks the delete', () => {
  quick('pending');
  const w = describeCountWorkForProduct(P);
  expect(w.total).toBe(1);
  expect(w.where).toContain('1 quick count');
});

test('a REJECTED quick count does NOT block — it was thrown away, and nothing could ever clear it', () => {
  quick('rejected');
  expect(describeCountWorkForProduct(P).total).toBe(0);
});

test('a frozen line in an UNTOUCHED count does NOT block — it is nobody’s work', () => {
  list(990020, 'Untouched'); session(990020, 'pending', 990020);
  frozen(990020);
  expect(describeCountWorkForProduct(P).total).toBe(0);
});

test('a frozen line in a SUBMITTED count does block — it justifies the numbers', () => {
  list(990021, 'Submitted'); session(990021, 'submitted', 990021);
  frozen(990021);
  const w = describeCountWorkForProduct(P);
  expect(w.total).toBe(1);
  expect(w.lockedLines).toBe(1);
});

test('another product’s work never blocks this one', () => {
  list(990030, 'Other'); session(990030, 'in_progress', 990030);
  entry(990030, 990999);
  quick('pending', 990999);
  expect(describeCountWorkForProduct(P).total).toBe(0);
});

test('work across several lists is all named, so the manager can act on it', () => {
  list(990040, 'Daily Count');
  list(990041, 'Bar Stock');
  session(990040, 'in_progress', 990040);
  session(990041, 'approved', 990041);
  entry(990040); entry(990040, P, 7); entry(990041);   // two spots on one list
  quick('pending');
  const w = describeCountWorkForProduct(P);
  expect(w.entries).toBe(3);
  expect(w.quick).toBe(1);
  const said = w.where.join(' | ');
  expect(said).toContain('Daily Count');
  expect(said).toContain('Bar Stock');
  expect(said).toContain('1 quick count');
});

test('a list cannot be deleted out from under a count, so the name is always there', () => {
  // The 'a count' fallback in describeCountWorkForProduct is belt-and-braces:
  // a foreign key makes the state it covers unreachable. Pinning that here so
  // nobody removes the FK and quietly turns every refusal into 'a count'.
  list(990050, 'Fridge Check');
  session(990050, 'in_progress', 990050);
  entry(990050);
  expect(() => getDb().prepare('DELETE FROM counting_templates WHERE id = 990050').run())
    .toThrow(/FOREIGN KEY/i);
  expect(describeCountWorkForProduct(P).where[0]).toBe('1 entry on "Fridge Check" (still being counted)');
});

test('countLockedLinesForProduct agrees with describe — one implementation', () => {
  list(990060, 'Daily Count');
  session(990060, 'in_progress', 990060);
  entry(990060); entry(990060, P, 7);
  expect(countLockedLinesForProduct(P)).toBe(describeCountWorkForProduct(P).total);
  expect(countLockedLinesForProduct(P)).toBe(2);
});

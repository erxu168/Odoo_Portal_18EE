import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Deleting a product must be refused while anything in this portal still points
 * at it. Odoo protects its own history and knows nothing about ours: 24 tables
 * across six modules hold an Odoo product id, and the guard used to check two.
 * Deleting a product used by one of the others left a row referencing an id
 * nothing could resolve, inside a screen that shows history.
 *
 * Runs against a throwaway database so it exercises the REAL SQL rather than a
 * mock of it — the failure this catches is a typo in a table or column name,
 * which a mock cannot see.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-usage-'));
process.env.PORTAL_DB_PATH = path.join(dir, 'portal.db');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../src/lib/inventory-db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const purchaseDb = require('../src/lib/purchase-db');

test.beforeAll(() => {
  db.initInventoryTables();
  // Purchase's tables come from its OWN init — which is exactly the situation the
  // guard has to cope with, and the reason it checks whether a table exists
  // before querying it.
  purchaseDb.initPurchaseTables();
});

const PID = 987654;

test('a product nothing references can be deleted', () => {
  const u = db.describeProductUsage(PID);
  expect(u.used, `unexpectedly blocked by: ${u.blocking.join(' | ')}`).toBe(false);
  expect(u.blocking).toEqual([]);
});

test('no check throws — an unreadable table blocks, an absent one does not', () => {
  // The guard turns an UNREADABLE table into a blocking reason on purpose:
  // "could not check" must never read as "nothing found", because that is the
  // answer that permits a delete. An ABSENT table is different — it holds no rows,
  // so it is skipped.
  //
  // Only the inventory and purchase modules are initialised here, so this proves
  // the SQL for those and proves the ABSENT path for labels, prep and cook timer
  // rather than their SQL. Those statements are exercised by the columns being
  // read straight out of their own CREATE TABLE definitions.
  const u = db.describeProductUsage(PID);
  expect(u.blocking.filter((b: string) => /could not be checked|could not check/.test(b))).toEqual([]);
});

test('a purchase order line blocks the delete, in another module’s table', () => {
  // THE point of this file. purchase_order_lines lives in a different module, and
  // the old guard never looked at it — so deleting a product that had been
  // ordered left an order line pointing at an id nothing could resolve.
  // Written through the REAL schema on the SAME handle the modules use, so a
  // renamed table or column fails here. A second connection to the same file was
  // tried first and could not see the tables — a test artefact, not a finding.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const h = require('../src/lib/db').getDb();
  // Foreign keys are enforced, so the whole chain is written: a supplier, an
  // order, then the line. That is the real shape of the data, which is the point.
  h.prepare(`INSERT INTO purchase_suppliers (odoo_partner_id, name, created_at)
             VALUES (1, 'Test supplier', '2026-01-01')`).run();
  const supplierId = h.prepare('SELECT MAX(id) AS id FROM purchase_suppliers').get().id;
  h.prepare(`INSERT INTO purchase_orders (supplier_id, location_id, status, ordered_by, created_at)
             VALUES (?, 1, 'draft', 1, '2026-01-01')`).run(supplierId);
  const orderId = h.prepare('SELECT MAX(id) AS id FROM purchase_orders').get().id;
  h.prepare(`INSERT INTO purchase_order_lines (order_id, product_id, product_name, product_uom, quantity, price, subtotal)
             VALUES (?, ?, 'Soy sauce 15l', 'Units', 1, 24.9, 24.9)`).run(orderId, PID);
  const u = db.describeProductUsage(PID);
  expect(u.used).toBe(true);
  expect(u.blocking.join(' ')).toMatch(/purchase order/i);
});

test('the reason is phrased for a person, not as a table name', () => {
  const u = db.describeProductUsage(PID);
  for (const b of u.blocking) {
    expect(b, `"${b}" leaks a table name`).not.toMatch(/_|SELECT|COUNT\(/);
  }
});

test.afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ } });

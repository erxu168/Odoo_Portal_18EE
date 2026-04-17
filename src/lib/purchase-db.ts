/**
 * Purchase module SQLite database.
 * Stores suppliers, order guides, shared carts, orders, and receipts.
 * Odoo purchase.order is created via JSON-RPC when order is sent.
 */
import { getDb } from './db';
import type Database from 'better-sqlite3';

function nowISO(): string {
  return new Date().toISOString();
}

function db(): Database.Database {
  return getDb();
}

// ============================================================
// SCHEMA INIT
// ============================================================
export function initPurchaseTables() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS purchase_suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      odoo_partner_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      send_method TEXT NOT NULL DEFAULT 'email',
      whatsapp_number TEXT NOT NULL DEFAULT '',
      min_order_value REAL NOT NULL DEFAULT 0,
      order_days TEXT NOT NULL DEFAULT '[]',
      delivery_days TEXT NOT NULL DEFAULT '[]',
      lead_time_days INTEGER NOT NULL DEFAULT 1,
      approval_required INTEGER NOT NULL DEFAULT 0,
      location_id INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_order_guides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES purchase_suppliers(id),
      location_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_guide_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guide_id INTEGER NOT NULL REFERENCES purchase_order_guides(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      product_uom TEXT NOT NULL DEFAULT 'Units',
      price REAL NOT NULL DEFAULT 0,
      price_source TEXT NOT NULL DEFAULT 'manual',
      sort_order INTEGER NOT NULL DEFAULT 0,
      category_name TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS purchase_carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL REFERENCES purchase_suppliers(id),
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL REFERENCES purchase_carts(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      product_uom TEXT NOT NULL DEFAULT 'Units',
      quantity REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      added_by INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      odoo_po_id INTEGER,
      odoo_po_name TEXT,
      supplier_id INTEGER NOT NULL REFERENCES purchase_suppliers(id),
      location_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      delivery_date TEXT,
      order_note TEXT NOT NULL DEFAULT '',
      total_amount REAL NOT NULL DEFAULT 0,
      ordered_by INTEGER NOT NULL,
      approved_by INTEGER,
      cancelled_by INTEGER,
      cancelled_at TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      product_uom TEXT NOT NULL DEFAULT 'Units',
      quantity REAL NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS purchase_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
      location_id INTEGER NOT NULL DEFAULT 32,
      status TEXT NOT NULL DEFAULT 'pending',
      received_by INTEGER NOT NULL,
      confirmed_by INTEGER,
      delivery_note_photo TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
      order_line_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      product_uom TEXT NOT NULL DEFAULT 'Units',
      ordered_qty REAL NOT NULL,
      received_qty REAL,
      difference REAL NOT NULL DEFAULT 0,
      has_issue INTEGER NOT NULL DEFAULT 0,
      issue_type TEXT,
      issue_photo TEXT,
      issue_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_guides_supplier ON purchase_order_guides(supplier_id, location_id);
    CREATE INDEX IF NOT EXISTS idx_guide_items ON purchase_guide_items(guide_id);
    CREATE INDEX IF NOT EXISTS idx_carts_loc ON purchase_carts(location_id, supplier_id, status);
    CREATE INDEX IF NOT EXISTS idx_cart_items ON purchase_cart_items(cart_id);
    CREATE INDEX IF NOT EXISTS idx_orders_loc ON purchase_orders(location_id, status);
    CREATE INDEX IF NOT EXISTS idx_order_lines ON purchase_order_lines(order_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_order ON purchase_receipts(order_id);
    CREATE INDEX IF NOT EXISTS idx_receipt_lines ON purchase_receipt_lines(receipt_id);
  `);

  // Migration: add columns that may not exist on older DBs
  try { db().exec('ALTER TABLE purchase_receipts ADD COLUMN location_id INTEGER NOT NULL DEFAULT 32'); } catch (_e) { /* already exists */ }
  try { db().exec('ALTER TABLE purchase_receipt_lines ADD COLUMN product_uom TEXT NOT NULL DEFAULT "Units"'); } catch (_e) { /* already exists */ }
  try { db().exec('ALTER TABLE purchase_orders ADD COLUMN cancelled_by INTEGER'); } catch (_e) { /* already exists */ }
  try { db().exec('ALTER TABLE purchase_orders ADD COLUMN cancelled_at TEXT'); } catch (_e) { /* already exists */ }
  // v2: delivery_days for supplier delivery schedule alerts
  try { db().exec("ALTER TABLE purchase_suppliers ADD COLUMN delivery_days TEXT NOT NULL DEFAULT '[]'"); } catch (_e) { /* already exists */ }
}

// ============================================================
// SUPPLIERS
// ============================================================
export function listSuppliers(locationId?: number) {
  if (locationId) {
    return db().prepare(
      'SELECT * FROM purchase_suppliers WHERE active = 1 AND (location_id = ? OR location_id = 0) ORDER BY name'
    ).all(locationId);
  }
  return db().prepare('SELECT * FROM purchase_suppliers WHERE active = 1 ORDER BY name').all();
}

export function getSupplier(id: number) {
  return db().prepare('SELECT * FROM purchase_suppliers WHERE id = ?').get(id);
}

export function createSupplier(data: {
  odoo_partner_id: number; name: string; email: string; phone: string;
  send_method: string; min_order_value?: number; order_days?: string;
  delivery_days?: string; lead_time_days?: number; approval_required?: number;
  location_id?: number;
}) {
  const result = db().prepare(`
    INSERT INTO purchase_suppliers (odoo_partner_id, name, email, phone, send_method, 
      min_order_value, order_days, delivery_days, lead_time_days, approval_required, location_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.odoo_partner_id, data.name, data.email, data.phone, data.send_method,
    data.min_order_value || 0, data.order_days || '[]', data.delivery_days || '[]',
    data.lead_time_days || 1, data.approval_required || 0, data.location_id || 0, nowISO()
  );
  return result.lastInsertRowid as number;
}

// Per-field type coercion so callers can't slip a non-number into min_order_value
// or drop an object into name. Each allowed field runs through its coercer;
// anything that can't be cleanly coerced is dropped (not rejected loudly — the
// caller gets a silent skip for that single field). Unknown fields stay skipped
// by the allowlist check.
const SUPPLIER_FIELD_COERCERS: Record<string, (v: unknown) => unknown | undefined> = {
  name: (v) => typeof v === 'string' ? v.slice(0, 200) : undefined,
  email: (v) => typeof v === 'string' ? v.slice(0, 200) : undefined,
  phone: (v) => typeof v === 'string' ? v.slice(0, 50) : undefined,
  send_method: (v) => typeof v === 'string' && ['email', 'whatsapp', 'manual'].includes(v) ? v : undefined,
  whatsapp_number: (v) => typeof v === 'string' ? v.slice(0, 50) : undefined,
  min_order_value: (v) => typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined,
  order_days: (v) => typeof v === 'string' ? v.slice(0, 200) : undefined,
  delivery_days: (v) => typeof v === 'string' ? v.slice(0, 200) : undefined,
  lead_time_days: (v) => {
    const n = typeof v === 'number' ? v : parseInt(String(v));
    return Number.isInteger(n) && n >= 0 && n <= 365 ? n : undefined;
  },
  approval_required: (v) => (v === 0 || v === 1 || v === false || v === true) ? (v ? 1 : 0) : undefined,
  location_id: (v) => {
    const n = typeof v === 'number' ? v : parseInt(String(v));
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  },
  active: (v) => (v === 0 || v === 1 || v === false || v === true) ? (v ? 1 : 0) : undefined,
};

export function updateSupplier(id: number, data: Record<string, any>) {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const coerce = SUPPLIER_FIELD_COERCERS[k];
    if (!coerce) continue;
    const coerced = coerce(v);
    if (coerced === undefined) continue;
    sets.push(`${k} = ?`);
    vals.push(coerced);
  }
  if (sets.length === 0) return;
  vals.push(id);
  db().prepare(`UPDATE purchase_suppliers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

// ============================================================
// ORDER GUIDES
// ============================================================
export function getGuide(supplierId: number, locationId: number) {
  return db().prepare(
    'SELECT * FROM purchase_order_guides WHERE supplier_id = ? AND location_id = ?'
  ).get(supplierId, locationId) as any;
}

export function getGuideWithItems(supplierId: number, locationId: number) {
  const guide = getGuide(supplierId, locationId);
  if (!guide) return null;
  const items = db().prepare(
    'SELECT * FROM purchase_guide_items WHERE guide_id = ? ORDER BY category_name, sort_order, product_name'
  ).all(guide.id);
  return { ...guide, items };
}

export function createGuide(supplierId: number, locationId: number, name: string) {
  // Fall back to the supplier's name so the guide never renders as "untitled"
  // in the UI. Callers historically pass '' when they don't have a better name.
  let resolvedName = (name || '').trim();
  if (!resolvedName) {
    const supplier = getSupplier(supplierId) as { name?: string } | undefined;
    resolvedName = supplier?.name || `Guide ${supplierId}`;
  }
  const result = db().prepare(
    'INSERT INTO purchase_order_guides (supplier_id, location_id, name, created_at) VALUES (?, ?, ?, ?)'
  ).run(supplierId, locationId, resolvedName, nowISO());
  return result.lastInsertRowid as number;
}

export function addGuideItem(guideId: number, item: {
  product_id: number; product_name: string; product_uom: string;
  price: number; price_source: string; category_name: string; sort_order?: number;
}) {
  const result = db().prepare(`
    INSERT INTO purchase_guide_items (guide_id, product_id, product_name, product_uom, price, price_source, category_name, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(guideId, item.product_id, item.product_name, item.product_uom,
    item.price, item.price_source, item.category_name, item.sort_order || 0);
  return result.lastInsertRowid as number;
}

export function removeGuideItem(itemId: number) {
  db().prepare('DELETE FROM purchase_guide_items WHERE id = ?').run(itemId);
}

export function updateGuideItemPrice(itemId: number, price: number, source: string) {
  db().prepare('UPDATE purchase_guide_items SET price = ?, price_source = ? WHERE id = ?').run(price, source, itemId);
}

// ============================================================
// SHARED CARTS
// ============================================================
export function getOrCreateCart(locationId: number, supplierId: number, userId: number) {
  let cart = db().prepare(
    "SELECT * FROM purchase_carts WHERE location_id = ? AND supplier_id = ? AND status = 'draft'"
  ).get(locationId, supplierId) as any;
  if (!cart) {
    const now = nowISO();
    const result = db().prepare(
      'INSERT INTO purchase_carts (location_id, supplier_id, status, created_by, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(locationId, supplierId, 'draft', userId, now, now);
    cart = db().prepare('SELECT * FROM purchase_carts WHERE id = ?').get(result.lastInsertRowid);
  }
  return cart;
}

export function getCartWithItems(cartId: number) {
  const cart = db().prepare('SELECT * FROM purchase_carts WHERE id = ?').get(cartId) as any;
  if (!cart) return null;
  const items = db().prepare(
    'SELECT * FROM purchase_cart_items WHERE cart_id = ? AND quantity > 0 ORDER BY product_name'
  ).all(cartId);
  return { ...cart, items };
}

export function getAllCartsForLocation(locationId: number) {
  const carts = db().prepare(
    "SELECT c.*, s.name as supplier_name, s.send_method, s.min_order_value, s.approval_required FROM purchase_carts c JOIN purchase_suppliers s ON s.id = c.supplier_id WHERE c.location_id = ? AND c.status = 'draft'"
  ).all(locationId) as any[];
  return carts.map(cart => {
    const items = db().prepare(
      'SELECT * FROM purchase_cart_items WHERE cart_id = ? AND quantity > 0'
    ).all(cart.id);
    const total = items.reduce((sum: number, i: any) => sum + (i.quantity * i.price), 0);
    return { ...cart, items, item_count: items.length, total };
  });
}

export function upsertCartItem(cartId: number, productId: number, quantity: number, userId: number, extra?: {
  product_name?: string; product_uom?: string; price?: number;
}) {
  const now = nowISO();
  const existing = db().prepare(
    'SELECT id FROM purchase_cart_items WHERE cart_id = ? AND product_id = ?'
  ).get(cartId, productId) as any;

  if (existing) {
    if (quantity <= 0) {
      db().prepare('DELETE FROM purchase_cart_items WHERE id = ?').run(existing.id);
    } else {
      db().prepare(
        'UPDATE purchase_cart_items SET quantity = ?, added_by = ?, updated_at = ? WHERE id = ?'
      ).run(quantity, userId, now, existing.id);
    }
  } else if (quantity > 0) {
    db().prepare(`
      INSERT INTO purchase_cart_items (cart_id, product_id, product_name, product_uom, quantity, price, added_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cartId, productId, extra?.product_name || '', extra?.product_uom || 'Units',
      quantity, extra?.price || 0, userId, now);
  }
  db().prepare('UPDATE purchase_carts SET updated_at = ? WHERE id = ?').run(now, cartId);
}

export function removeCartItem(cartId: number, productId: number) {
  db().prepare('DELETE FROM purchase_cart_items WHERE cart_id = ? AND product_id = ?').run(cartId, productId);
  db().prepare('UPDATE purchase_carts SET updated_at = ? WHERE id = ?').run(nowISO(), cartId);
}

export function clearCart(cartId: number) {
  db().prepare('DELETE FROM purchase_cart_items WHERE cart_id = ?').run(cartId);
  db().prepare('DELETE FROM purchase_carts WHERE id = ?').run(cartId);
}

// ============================================================
// ORDERS
// ============================================================
export function createOrder(data: {
  supplier_id: number; location_id: number; delivery_date: string | null;
  order_note: string; total_amount: number; ordered_by: number;
  status: string; lines: Array<{
    product_id: number; product_name: string; product_uom: string;
    quantity: number; price: number;
  }>;
}) {
  const now = nowISO();
  const result = db().prepare(`
    INSERT INTO purchase_orders (supplier_id, location_id, status, delivery_date, order_note, total_amount, ordered_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.supplier_id, data.location_id, data.status, data.delivery_date,
    data.order_note, data.total_amount, data.ordered_by, now);
  const orderId = result.lastInsertRowid as number;

  const insertLine = db().prepare(`
    INSERT INTO purchase_order_lines (order_id, product_id, product_name, product_uom, quantity, price, subtotal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of data.lines) {
    insertLine.run(orderId, line.product_id, line.product_name, line.product_uom,
      line.quantity, line.price, line.quantity * line.price);
  }
  return orderId;
}

export function getOrder(id: number) {
  const order = db().prepare(
    'SELECT o.*, s.name as supplier_name FROM purchase_orders o JOIN purchase_suppliers s ON s.id = o.supplier_id WHERE o.id = ?'
  ).get(id) as any;
  if (!order) return null;
  order.lines = db().prepare('SELECT * FROM purchase_order_lines WHERE order_id = ?').all(id);
  // Attach latest-receipt timestamps so the UI can build a delivery timeline without a second fetch.
  const receipt = db().prepare(
    'SELECT status, created_at, confirmed_at FROM purchase_receipts WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(id) as { status?: string; created_at?: string; confirmed_at?: string } | undefined;
  order.receipt_status = receipt?.status || null;
  order.receipt_created_at = receipt?.created_at || null;
  order.receipt_confirmed_at = receipt?.confirmed_at || null;
  return order;
}

export function listOrders(locationId: number, options?: { status?: string; limit?: number }) {
  let sql = 'SELECT o.*, s.name as supplier_name FROM purchase_orders o JOIN purchase_suppliers s ON s.id = o.supplier_id WHERE o.location_id = ?';
  const params: any[] = [locationId];
  if (options?.status) { sql += ' AND o.status = ?'; params.push(options.status); }
  sql += ' ORDER BY o.created_at DESC';
  if (options?.limit) { sql += ' LIMIT ?'; params.push(options.limit); }
  return db().prepare(sql).all(...params);
}

export function updateOrderStatus(id: number, status: string, extra?: { odoo_po_id?: number; odoo_po_name?: string; approved_by?: number; sent_at?: string }) {
  const sets = ['status = ?'];
  const vals: any[] = [status];
  if (extra?.odoo_po_id !== undefined) { sets.push('odoo_po_id = ?'); vals.push(extra.odoo_po_id); }
  if (extra?.odoo_po_name !== undefined) { sets.push('odoo_po_name = ?'); vals.push(extra.odoo_po_name); }
  if (extra?.approved_by !== undefined) { sets.push('approved_by = ?'); vals.push(extra.approved_by); }
  if (extra?.sent_at !== undefined) { sets.push('sent_at = ?'); vals.push(extra.sent_at); }
  vals.push(id);
  db().prepare(`UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function cancelOrder(id: number, userId: number) {
  const now = nowISO();
  db().prepare(
    'UPDATE purchase_orders SET status = ?, cancelled_by = ?, cancelled_at = ? WHERE id = ?'
  ).run('cancelled', userId, now, id);
}

export function checkDuplicateOrder(supplierId: number, locationId: number): boolean {
  // Use Berlin calendar date (en-CA returns YYYY-MM-DD). The previous UTC-based
  // comparison flipped "today" 1-2 hours before Berlin midnight and incorrectly
  // flagged orders from the prior Berlin calendar day as same-day duplicates.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const row = db().prepare(
    "SELECT COUNT(*) as c FROM purchase_orders WHERE supplier_id = ? AND location_id = ? AND status != 'cancelled' AND created_at >= ?"
  ).get(supplierId, locationId, today + 'T00:00:00') as any;
  return (row?.c || 0) > 0;
}

export function countPendingApprovals(locationId?: number) {
  if (locationId) {
    return (db().prepare(
      "SELECT COUNT(*) as c FROM purchase_orders WHERE status = 'pending_approval' AND location_id = ?"
    ).get(locationId) as any).c;
  }
  return (db().prepare("SELECT COUNT(*) as c FROM purchase_orders WHERE status = 'pending_approval'").get() as any).c;
}

// ============================================================
// RECEIPTS
// ============================================================
export function createReceipt(orderId: number, receivedBy: number) {
  const order = getOrder(orderId);
  if (!order) return null;
  const now = nowISO();
  const result = db().prepare(
    'INSERT INTO purchase_receipts (order_id, location_id, status, received_by, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(orderId, order.location_id, 'pending', receivedBy, '', now);
  const receiptId = result.lastInsertRowid as number;

  const insertLine = db().prepare(`
    INSERT INTO purchase_receipt_lines (receipt_id, order_line_id, product_id, product_name, product_uom, ordered_qty)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const line of order.lines) {
    insertLine.run(receiptId, line.id, line.product_id, line.product_name, line.product_uom || 'Units', line.quantity);
  }
  return receiptId;
}

export function getReceipt(id: number) {
  const receipt = db().prepare('SELECT * FROM purchase_receipts WHERE id = ?').get(id) as any;
  if (!receipt) return null;
  receipt.lines = db().prepare('SELECT * FROM purchase_receipt_lines WHERE receipt_id = ?').all(id);
  return receipt;
}

export function getReceiptByOrder(orderId: number) {
  const receipt = db().prepare(
    "SELECT * FROM purchase_receipts WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(orderId) as any;
  if (!receipt) return null;
  receipt.lines = db().prepare('SELECT * FROM purchase_receipt_lines WHERE receipt_id = ?').all(receipt.id);
  return receipt;
}

export function updateReceiptLine(lineId: number, data: {
  received_qty?: number; has_issue?: number; issue_type?: string;
  issue_photo?: string; issue_notes?: string;
}) {
  const sets: string[] = [];
  const vals: any[] = [];
  if (data.received_qty !== undefined) { sets.push('received_qty = ?'); vals.push(data.received_qty); }
  if (data.has_issue !== undefined) { sets.push('has_issue = ?'); vals.push(data.has_issue); }
  if (data.issue_type !== undefined) { sets.push('issue_type = ?'); vals.push(data.issue_type); }
  if (data.issue_photo !== undefined) { sets.push('issue_photo = ?'); vals.push(data.issue_photo); }
  if (data.issue_notes !== undefined) { sets.push('issue_notes = ?'); vals.push(data.issue_notes); }
  if (sets.length === 0) return;
  vals.push(lineId);
  db().prepare(`UPDATE purchase_receipt_lines SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  // Recalc difference
  if (data.received_qty !== undefined) {
    db().prepare('UPDATE purchase_receipt_lines SET difference = received_qty - ordered_qty WHERE id = ?').run(lineId);
  }
}

export function confirmReceipt(receiptId: number, confirmedBy: number, closeOrder: boolean) {
  const now = nowISO();
  db().prepare(
    'UPDATE purchase_receipts SET status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?'
  ).run('confirmed', confirmedBy, now, receiptId);

  const receipt = getReceipt(receiptId);
  if (receipt) {
    if (closeOrder) {
      updateOrderStatus(receipt.order_id, 'received');
    } else {
      updateOrderStatus(receipt.order_id, 'partial');
    }
  }
}

export function updateReceiptNote(receiptId: number, photo: string) {
  db().prepare('UPDATE purchase_receipts SET delivery_note_photo = ? WHERE id = ?').run(photo, receiptId);
}

// ============================================================
// SETTINGS
// ============================================================
export function getSetting(key: string): string {
  const row = db().prepare('SELECT value FROM purchase_settings WHERE key = ?').get(key) as any;
  return row?.value || '';
}

export function setSetting(key: string, value: string) {
  db().prepare(
    'INSERT INTO purchase_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).run(key, value, value);
}

// Init on import
try { initPurchaseTables(); } catch (_e) { /* tables may already exist */ }

/**
 * KDS SQLite database — settings, product config, and per-item checked state.
 * Survives tablet reboots so cooks don't lose in-progress ticks mid-shift.
 */
import { getDb } from './db';
import type { KdsSettings } from '@/types/kds';
import { DEFAULT_SETTINGS, KDS_LOCATION_ID } from '@/types/kds';

function nowISO(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T');
}

let _initialized = false;

function ensureTables() {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS kds_settings (
      id INTEGER PRIMARY KEY,
      location_id INTEGER NOT NULL,
      takeaway_boost INTEGER DEFAULT 4,
      dine_warn INTEGER DEFAULT 5,
      dine_urg INTEGER DEFAULT 10,
      ta_warn INTEGER DEFAULT 3,
      ta_urg INTEGER DEFAULT 6,
      pass_warn INTEGER DEFAULT 2,
      pass_crit INTEGER DEFAULT 5,
      snd_new_order INTEGER DEFAULT 1,
      snd_new_order_mode TEXT DEFAULT 'always',
      snd_new_order_vol REAL DEFAULT 0.7,
      snd_pass INTEGER DEFAULT 1,
      snd_pass_mode TEXT DEFAULT 'repeat',
      snd_pass_vol REAL DEFAULT 0.8,
      snd_round INTEGER DEFAULT 1,
      snd_round_vol REAL DEFAULT 0.6,
      auto_scroll_sec INTEGER DEFAULT 10,
      pos_config_id INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(location_id)
    );

    CREATE TABLE IF NOT EXISTS kds_product_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL,
      odoo_product_id INTEGER,
      product_name TEXT NOT NULL,
      source_station TEXT NOT NULL CHECK(source_station IN ('grill','drawer','pot','fryer','cold')),
      prep_type TEXT NOT NULL CHECK(prep_type IN ('advance','batch','ondemand')),
      prep_time_min INTEGER,
      reheat_time_min INTEGER,
      max_holding_min INTEGER,
      batch_size INTEGER,
      UNIQUE(location_id, product_name)
    );

    CREATE TABLE IF NOT EXISTS kds_order_checks (
      order_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (order_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS kds_completed_orders (
      order_id INTEGER PRIMARY KEY,
      stage TEXT NOT NULL CHECK(stage IN ('ready','done')),
      ready_at INTEGER,
      done_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_kds_product_config_odoo
      ON kds_product_config(location_id, odoo_product_id);
  `);
  // Migrate: add auto_scroll_sec if missing
  const cols = db.prepare("PRAGMA table_info('kds_settings')").all() as { name: string }[];
  if (!cols.some(c => c.name === 'auto_scroll_sec')) {
    db.exec('ALTER TABLE kds_settings ADD COLUMN auto_scroll_sec INTEGER DEFAULT 10');
  }
  if (!cols.some(c => c.name === 'pos_config_id')) {
    db.exec('ALTER TABLE kds_settings ADD COLUMN pos_config_id INTEGER DEFAULT 0');
  }
  // Prune completed-order stages older than 3 days so the table stays small.
  db.prepare('DELETE FROM kds_completed_orders WHERE COALESCE(done_at, ready_at, 0) < ?')
    .run(Date.now() - 3 * 24 * 3600 * 1000);
  seedProductConfig(db);
  _initialized = true;
}

function seedProductConfig(db: ReturnType<typeof getDb>) {
  const count = db.prepare('SELECT COUNT(*) as c FROM kds_product_config WHERE location_id = ?').get(KDS_LOCATION_ID) as { c: number };
  if (count.c > 0) return;

  const products = [
    { name: 'Jerk Chicken',  station: 'grill',  prep: 'advance',  prepTime: 45, reheat: 8,    holding: 30, batch: 6 },
    { name: 'Jerk Pork',     station: 'grill',  prep: 'advance',  prepTime: 60, reheat: 8,    holding: 30, batch: 4 },
    { name: 'Curry Goat',    station: 'pot',    prep: 'advance',  prepTime: 90, reheat: 10,   holding: 45, batch: 8 },
    { name: 'Oxtail',        station: 'pot',    prep: 'advance',  prepTime: 120, reheat: 10,  holding: 45, batch: 6 },
    { name: 'Rice & Peas',   station: 'pot',    prep: 'batch',    prepTime: 40, reheat: 5,    holding: 60, batch: 10 },
    { name: 'Beef Patties',  station: 'fryer',  prep: 'batch',    prepTime: 15, reheat: 3,    holding: 20, batch: 12 },
    { name: 'Fried Chicken', station: 'drawer', prep: 'ondemand', prepTime: 12, reheat: null, holding: 15, batch: 4 },
    { name: 'Festival',      station: 'drawer', prep: 'batch',    prepTime: 8,  reheat: null, holding: 20, batch: 8 },
    { name: 'Plantain',      station: 'fryer',  prep: 'ondemand', prepTime: 5,  reheat: null, holding: 10, batch: 6 },
    { name: 'Coleslaw',      station: 'cold',   prep: 'advance',  prepTime: 15, reheat: null, holding: 180, batch: 20 },
  ];

  const stmt = db.prepare(
    'INSERT INTO kds_product_config (location_id, product_name, source_station, prep_type, prep_time_min, reheat_time_min, max_holding_min, batch_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const p of products) {
    stmt.run(KDS_LOCATION_ID, p.name, p.station, p.prep, p.prepTime, p.reheat, p.holding, p.batch);
  }
}

// -- Settings CRUD --

export function getKdsSettings(locationId: number): KdsSettings {
  ensureTables();
  const db = getDb();
  const row = db.prepare('SELECT * FROM kds_settings WHERE location_id = ?').get(locationId) as Record<string, unknown> | undefined;
  if (!row) return { ...DEFAULT_SETTINGS, locationId };
  return {
    locationId,
    takeawayBoost: row.takeaway_boost as number,
    dineWarn: row.dine_warn as number,
    dineUrg: row.dine_urg as number,
    taWarn: row.ta_warn as number,
    taUrg: row.ta_urg as number,
    passWarn: row.pass_warn as number,
    passCrit: row.pass_crit as number,
    sndNewOrder: row.snd_new_order === 1,
    sndNewOrderMode: row.snd_new_order_mode as 'always' | 'roundIdle',
    sndNewOrderVol: row.snd_new_order_vol as number,
    sndPass: row.snd_pass === 1,
    sndPassMode: row.snd_pass_mode as 'once' | 'repeat',
    sndPassVol: row.snd_pass_vol as number,
    sndRound: row.snd_round === 1,
    sndRoundVol: row.snd_round_vol as number,
    autoScrollSec: (row.auto_scroll_sec as number) ?? 10,
    posConfigId: (row.pos_config_id as number) ?? 0,
  };
}

// -- Product config read/write --

export interface ProductConfigRow {
  odoo_product_id: number | null;
  product_name: string;
  source_station: string;
  prep_type: string;
}

export function getProductConfig(locationId: number): ProductConfigRow[] {
  ensureTables();
  const db = getDb();
  return db.prepare(
    'SELECT odoo_product_id, product_name, source_station, prep_type FROM kds_product_config WHERE location_id = ?'
  ).all(locationId) as ProductConfigRow[];
}

export interface ProductSyncInput {
  odooProductId: number;
  productName: string;
}

export function upsertSyncedProducts(locationId: number, products: ProductSyncInput[]): number {
  ensureTables();
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO kds_product_config (location_id, odoo_product_id, product_name, source_station, prep_type)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(location_id, product_name) DO UPDATE SET odoo_product_id = excluded.odoo_product_id`
  );
  let count = 0;
  const tx = db.transaction((items: ProductSyncInput[]) => {
    for (const p of items) {
      const station = inferStation(p.productName);
      const prep = inferPrep(p.productName);
      insert.run(locationId, p.odooProductId, p.productName, station, prep);
      count += 1;
    }
  });
  tx(products);
  return count;
}

export function setProductMapping(
  locationId: number,
  productName: string,
  station: string,
  prepType: string
): void {
  ensureTables();
  const db = getDb();
  db.prepare(
    `UPDATE kds_product_config SET source_station = ?, prep_type = ?
     WHERE location_id = ? AND product_name = ?`
  ).run(station, prepType, locationId, productName);
}

// -- Order item checked state (survives reloads) --

export interface OrderCheckRow {
  order_id: number;
  item_id: string;
}

export function getOrderChecks(): OrderCheckRow[] {
  ensureTables();
  const db = getDb();
  return db.prepare('SELECT order_id, item_id FROM kds_order_checks').all() as OrderCheckRow[];
}

export function setOrderCheck(orderId: number, itemId: string, checked: boolean): void {
  ensureTables();
  const db = getDb();
  if (checked) {
    db.prepare(
      `INSERT OR REPLACE INTO kds_order_checks (order_id, item_id, checked_at) VALUES (?, ?, ?)`
    ).run(orderId, itemId, nowISO());
  } else {
    db.prepare(`DELETE FROM kds_order_checks WHERE order_id = ? AND item_id = ?`).run(orderId, itemId);
  }
}

export function clearOrderChecks(orderId: number): void {
  ensureTables();
  const db = getDb();
  db.prepare(`DELETE FROM kds_order_checks WHERE order_id = ?`).run(orderId);
}

// -- Completed order stages (ready/done -- survives tablet reboots) --
// The KDS never writes order state to Odoo; kitchen progress lives here.

export interface CompletedOrderRow {
  order_id: number;
  stage: 'ready' | 'done';
  ready_at: number | null;
  done_at: number | null;
}

export function getCompletedOrders(): CompletedOrderRow[] {
  ensureTables();
  const db = getDb();
  return db.prepare(
    'SELECT order_id, stage, ready_at, done_at FROM kds_completed_orders'
  ).all() as CompletedOrderRow[];
}

export function setOrderStage(orderId: number, stage: 'ready' | 'done'): void {
  ensureTables();
  const db = getDb();
  const now = Date.now();
  if (stage === 'ready') {
    db.prepare(`
      INSERT INTO kds_completed_orders (order_id, stage, ready_at, done_at)
      VALUES (?, 'ready', ?, NULL)
      ON CONFLICT(order_id) DO UPDATE SET
        stage = 'ready',
        ready_at = COALESCE(kds_completed_orders.ready_at, excluded.ready_at)
    `).run(orderId, now);
  } else {
    db.prepare(`
      INSERT INTO kds_completed_orders (order_id, stage, ready_at, done_at)
      VALUES (?, 'done', ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        stage = 'done',
        done_at = excluded.done_at,
        ready_at = COALESCE(kds_completed_orders.ready_at, excluded.ready_at)
    `).run(orderId, now, now);
  }
}

export function clearOrderStage(orderId: number): void {
  ensureTables();
  const db = getDb();
  db.prepare('DELETE FROM kds_completed_orders WHERE order_id = ?').run(orderId);
}

// Heuristic seed for newly-synced products. Manager can override later via UI.
function inferStation(name: string): string {
  const n = name.toLowerCase();
  if (/jerk|grill|bbq/.test(n)) return 'grill';
  if (/curry|oxtail|rice|peas|stew/.test(n)) return 'pot';
  if (/plantain|festival|patty|fries|chip/.test(n)) return 'fryer';
  if (/fried chicken|wing|drawer/.test(n)) return 'drawer';
  if (/slaw|salad|sauce|cold/.test(n)) return 'cold';
  return 'grill';
}

function inferPrep(name: string): string {
  const n = name.toLowerCase();
  if (/curry|oxtail|jerk chicken|jerk pork|rice|slaw/.test(n)) return 'advance';
  if (/festival|patty|chip/.test(n)) return 'batch';
  return 'ondemand';
}

export function saveKdsSettings(s: KdsSettings): void {
  ensureTables();
  const db = getDb();
  db.prepare(`
    INSERT INTO kds_settings (location_id, takeaway_boost, dine_warn, dine_urg, ta_warn, ta_urg, pass_warn, pass_crit, snd_new_order, snd_new_order_mode, snd_new_order_vol, snd_pass, snd_pass_mode, snd_pass_vol, snd_round, snd_round_vol, auto_scroll_sec, pos_config_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(location_id) DO UPDATE SET
      takeaway_boost=excluded.takeaway_boost, dine_warn=excluded.dine_warn, dine_urg=excluded.dine_urg,
      ta_warn=excluded.ta_warn, ta_urg=excluded.ta_urg, pass_warn=excluded.pass_warn, pass_crit=excluded.pass_crit,
      snd_new_order=excluded.snd_new_order, snd_new_order_mode=excluded.snd_new_order_mode, snd_new_order_vol=excluded.snd_new_order_vol,
      snd_pass=excluded.snd_pass, snd_pass_mode=excluded.snd_pass_mode, snd_pass_vol=excluded.snd_pass_vol,
      snd_round=excluded.snd_round, snd_round_vol=excluded.snd_round_vol, auto_scroll_sec=excluded.auto_scroll_sec,
      pos_config_id=excluded.pos_config_id, updated_at=excluded.updated_at
  `).run(
    s.locationId, s.takeawayBoost, s.dineWarn, s.dineUrg, s.taWarn, s.taUrg,
    s.passWarn, s.passCrit, s.sndNewOrder ? 1 : 0, s.sndNewOrderMode, s.sndNewOrderVol,
    s.sndPass ? 1 : 0, s.sndPassMode, s.sndPassVol, s.sndRound ? 1 : 0, s.sndRoundVol,
    s.autoScrollSec, s.posConfigId, nowISO()
  );
}

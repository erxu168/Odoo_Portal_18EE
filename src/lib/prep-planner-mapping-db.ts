/**
 * Prep Planner Phase 2 — prep items, POS→prep mapping, and item-level forecasts.
 *
 * Problem this solves:
 *   Phase 1 forecasts POS products: "tomorrow 21:00, sell 8 Extra Rice".
 *   The cook doesn't think in POS SKUs — she thinks "how many portions of
 *   cooked rice do I need ready to plate?" And one prep item (Rice) may be
 *   driven by multiple POS products (Extra Rice, rice that ships inside
 *   'All About Beef', etc.) with different portions-per-sale multipliers.
 *
 * Tables:
 *   prep_items           — master list of cook-facing prep items per company
 *   prep_pos_link        — many-to-many: which POS products drive which prep items
 *   prep_item_forecasts  — derived per-hour forecasts aggregated to prep item
 *
 * prep_items is conceptually a superset of kds_product_config. When the KDS
 * module is next touched, kds_product_config should be migrated to read from
 * prep_items — but that's a separate change. This file doesn't modify KDS.
 *
 * Written per kds-db.ts / inventory-db.ts / issues-db.ts patterns:
 *   lazy ensureTables(), Berlin-time ISO strings, explicit INSERT/UPDATE stmts.
 */

import { getDb } from './db';

let _initialized = false;

export function initPrepMappingTables(): void {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS prep_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      location_id INTEGER,
      name TEXT NOT NULL,
      station TEXT,
      prep_type TEXT,
      prep_time_min INTEGER,
      max_holding_min INTEGER,
      batch_size INTEGER,
      unit TEXT NOT NULL DEFAULT 'portion',
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_prep_items_co ON prep_items(company_id, active);

    CREATE TABLE IF NOT EXISTS prep_pos_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prep_item_id INTEGER NOT NULL REFERENCES prep_items(id) ON DELETE CASCADE,
      pos_product_id INTEGER NOT NULL,
      pos_product_name TEXT NOT NULL,
      portions_per_sale REAL NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(prep_item_id, pos_product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prep_link_prep ON prep_pos_link(prep_item_id);
    CREATE INDEX IF NOT EXISTS idx_prep_link_pos  ON prep_pos_link(pos_product_id);

    CREATE TABLE IF NOT EXISTS prep_item_forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prep_item_id INTEGER NOT NULL REFERENCES prep_items(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL,
      target_date TEXT NOT NULL,
      target_hour INTEGER NOT NULL,
      forecast_portions REAL NOT NULL,
      source_products_json TEXT NOT NULL,
      forecast_run_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(prep_item_id, target_date, target_hour, forecast_run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pif_lookup
      ON prep_item_forecasts(company_id, target_date, target_hour);
    CREATE INDEX IF NOT EXISTS idx_pif_run
      ON prep_item_forecasts(forecast_run_id);
  `);
  _initialized = true;
}

// ── Types ───────────────────────────────────────────────

export interface PrepItem {
  id: number;
  company_id: number;
  location_id: number | null;
  name: string;
  station: string | null;
  prep_type: 'advance' | 'batch' | 'ondemand' | null;
  prep_time_min: number | null;
  max_holding_min: number | null;
  batch_size: number | null;
  unit: string;
  active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrepPosLink {
  id: number;
  prep_item_id: number;
  pos_product_id: number;
  pos_product_name: string;
  portions_per_sale: number;
  notes: string | null;
  created_at: string;
}

export interface PrepItemForecastRow {
  id?: number;
  prep_item_id: number;
  company_id: number;
  target_date: string;
  target_hour: number;
  forecast_portions: number;
  source_products_json: string;
  forecast_run_id: number;
  created_at: string;
}

export interface PrepItemForecastWithName extends PrepItemForecastRow {
  prep_item_name: string;
  prep_item_unit: string;
  prep_item_station: string | null;
  prep_item_batch_size: number | null;
}

// ── prep_items CRUD ─────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

export function listPrepItems(
  companyId: number,
  opts: { includeInactive?: boolean } = {},
): PrepItem[] {
  initPrepMappingTables();
  const db = getDb();
  const where = opts.includeInactive
    ? 'company_id = ?'
    : 'company_id = ? AND active = 1';
  return db.prepare(
    `SELECT * FROM prep_items WHERE ${where} ORDER BY name`,
  ).all(companyId) as PrepItem[];
}

export function getPrepItem(id: number): PrepItem | null {
  initPrepMappingTables();
  const db = getDb();
  return db.prepare('SELECT * FROM prep_items WHERE id = ?').get(id) as PrepItem | null;
}

export interface PrepItemInput {
  company_id: number;
  location_id?: number | null;
  name: string;
  station?: string | null;
  prep_type?: 'advance' | 'batch' | 'ondemand' | null;
  prep_time_min?: number | null;
  max_holding_min?: number | null;
  batch_size?: number | null;
  unit?: string;
  notes?: string | null;
}

export function createPrepItem(data: PrepItemInput): number {
  initPrepMappingTables();
  const db = getDb();
  const now = nowISO();
  const result = db.prepare(`
    INSERT INTO prep_items
      (company_id, location_id, name, station, prep_type,
       prep_time_min, max_holding_min, batch_size, unit, notes,
       active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    data.company_id,
    data.location_id ?? null,
    data.name.trim(),
    data.station ?? null,
    data.prep_type ?? null,
    data.prep_time_min ?? null,
    data.max_holding_min ?? null,
    data.batch_size ?? null,
    data.unit ?? 'portion',
    data.notes ?? null,
    now,
    now,
  );
  return result.lastInsertRowid as number;
}

export function updatePrepItem(
  id: number,
  data: Partial<PrepItemInput> & { active?: number },
): void {
  initPrepMappingTables();
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const maybeAdd = <K extends keyof (PrepItemInput & { active: number })>(
    key: K,
    col: string,
  ) => {
    if (data[key] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(data[key] ?? null);
    }
  };
  maybeAdd('name', 'name');
  maybeAdd('location_id', 'location_id');
  maybeAdd('station', 'station');
  maybeAdd('prep_type', 'prep_type');
  maybeAdd('prep_time_min', 'prep_time_min');
  maybeAdd('max_holding_min', 'max_holding_min');
  maybeAdd('batch_size', 'batch_size');
  maybeAdd('unit', 'unit');
  maybeAdd('notes', 'notes');
  maybeAdd('active', 'active');
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(nowISO());
  vals.push(id);
  db.prepare(`UPDATE prep_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deletePrepItem(id: number): void {
  initPrepMappingTables();
  const db = getDb();
  // ON DELETE CASCADE drops links + item-level forecasts.
  db.prepare('DELETE FROM prep_items WHERE id = ?').run(id);
}

// ── prep_pos_link CRUD ────────────────────────────────────

export function listLinksForPrepItem(prepItemId: number): PrepPosLink[] {
  initPrepMappingTables();
  const db = getDb();
  return db.prepare(
    'SELECT * FROM prep_pos_link WHERE prep_item_id = ? ORDER BY pos_product_name',
  ).all(prepItemId) as PrepPosLink[];
}

export function listAllLinksForCompany(companyId: number): (PrepPosLink & {
  prep_item_name: string;
})[] {
  initPrepMappingTables();
  const db = getDb();
  return db.prepare(`
    SELECT l.*, i.name AS prep_item_name
    FROM prep_pos_link l
    JOIN prep_items i ON i.id = l.prep_item_id
    WHERE i.company_id = ? AND i.active = 1
    ORDER BY i.name, l.pos_product_name
  `).all(companyId) as (PrepPosLink & { prep_item_name: string })[];
}

export function upsertLink(data: {
  prep_item_id: number;
  pos_product_id: number;
  pos_product_name: string;
  portions_per_sale: number;
  notes?: string | null;
}): number {
  initPrepMappingTables();
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM prep_pos_link WHERE prep_item_id = ? AND pos_product_id = ?',
  ).get(data.prep_item_id, data.pos_product_id) as { id: number } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE prep_pos_link
      SET pos_product_name = ?, portions_per_sale = ?, notes = ?
      WHERE id = ?
    `).run(
      data.pos_product_name,
      data.portions_per_sale,
      data.notes ?? null,
      existing.id,
    );
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO prep_pos_link
      (prep_item_id, pos_product_id, pos_product_name, portions_per_sale, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.prep_item_id,
    data.pos_product_id,
    data.pos_product_name,
    data.portions_per_sale,
    data.notes ?? null,
    nowISO(),
  );
  return result.lastInsertRowid as number;
}

export function deleteLink(id: number): void {
  initPrepMappingTables();
  const db = getDb();
  db.prepare('DELETE FROM prep_pos_link WHERE id = ?').run(id);
}

// ── prep_item_forecasts (derived) ────────────────────────

export interface PosFcstSlice {
  company_id: number;
  product_id: number;
  product_name: string;
  target_date: string;
  target_hour: number;
  forecast_qty: number;
}

/**
 * Aggregate POS-product-level forecasts into prep-item-level forecasts
 * using the active prep_pos_link map. This reads from prep_forecasts
 * (written by computeForecasts in Phase 1) and writes derived rows
 * into prep_item_forecasts.
 *
 * Returns the number of prep-item-forecast rows written.
 */
export function computePrepItemForecasts(
  companyId: number,
  runId: number,
): number {
  initPrepMappingTables();
  const db = getDb();

  // Pull all links for this company, keyed by pos_product_id.
  const links = db.prepare(`
    SELECT l.pos_product_id, l.prep_item_id, l.portions_per_sale
    FROM prep_pos_link l
    JOIN prep_items i ON i.id = l.prep_item_id
    WHERE i.company_id = ? AND i.active = 1
  `).all(companyId) as {
    pos_product_id: number;
    prep_item_id: number;
    portions_per_sale: number;
  }[];

  if (links.length === 0) return 0;

  const linksByPos = new Map<number, typeof links>();
  for (const l of links) {
    const bucket = linksByPos.get(l.pos_product_id);
    if (bucket) bucket.push(l);
    else linksByPos.set(l.pos_product_id, [l]);
  }

  // Pull all POS-level forecasts for this run/company whose product is mapped.
  const posFcst = db.prepare(`
    SELECT product_id, product_name, target_date, target_hour, forecast_qty
    FROM prep_forecasts
    WHERE company_id = ? AND forecast_run_id = ?
      AND product_id IN (${Array.from(linksByPos.keys()).map(() => '?').join(',')})
  `).all(companyId, runId, ...linksByPos.keys()) as {
    product_id: number;
    product_name: string;
    target_date: string;
    target_hour: number;
    forecast_qty: number;
  }[];

  if (posFcst.length === 0) return 0;

  // Aggregate: (prep_item_id, date, hour) → { portions, sources[] }
  type Agg = {
    portions: number;
    sources: { pos_product_id: number; pos_product_name: string; qty: number; portions: number }[];
  };
  const agg = new Map<string, Agg>();

  for (const f of posFcst) {
    const applicable = linksByPos.get(f.product_id) || [];
    for (const link of applicable) {
      const portions = f.forecast_qty * link.portions_per_sale;
      const key = `${link.prep_item_id}|${f.target_date}|${f.target_hour}`;
      let a = agg.get(key);
      if (!a) {
        a = { portions: 0, sources: [] };
        agg.set(key, a);
      }
      a.portions += portions;
      a.sources.push({
        pos_product_id: f.product_id,
        pos_product_name: f.product_name,
        qty: f.forecast_qty,
        portions: Math.round(portions * 100) / 100,
      });
    }
  }

  const now = nowISO();
  const stmt = db.prepare(`
    INSERT INTO prep_item_forecasts
      (prep_item_id, company_id, target_date, target_hour,
       forecast_portions, source_products_json, forecast_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(prep_item_id, target_date, target_hour, forecast_run_id) DO UPDATE SET
      forecast_portions = excluded.forecast_portions,
      source_products_json = excluded.source_products_json,
      created_at = excluded.created_at
  `);
  const tx = db.transaction(() => {
    let n = 0;
    for (const [key, a] of agg.entries()) {
      const [prepItemId, date, hourStr] = key.split('|');
      stmt.run(
        parseInt(prepItemId, 10),
        companyId,
        date,
        parseInt(hourStr, 10),
        Math.round(a.portions * 100) / 100,
        JSON.stringify(a.sources),
        runId,
        now,
      );
      n++;
    }
    return n;
  });
  return tx();
}

export function getLatestPrepItemForecasts(
  companyId: number,
  targetDate: string,
): PrepItemForecastWithName[] {
  initPrepMappingTables();
  const db = getDb();
  const latestRun = db.prepare(`
    SELECT id FROM prep_forecast_runs
    WHERE status = 'success'
    ORDER BY started_at DESC LIMIT 1
  `).get() as { id: number } | undefined;
  if (!latestRun) return [];
  return db.prepare(`
    SELECT f.*, i.name AS prep_item_name, i.unit AS prep_item_unit,
           i.station AS prep_item_station, i.batch_size AS prep_item_batch_size
    FROM prep_item_forecasts f
    JOIN prep_items i ON i.id = f.prep_item_id
    WHERE f.company_id = ? AND f.target_date = ?
      AND f.forecast_run_id = ?
    ORDER BY i.name, f.target_hour
  `).all(companyId, targetDate, latestRun.id) as PrepItemForecastWithName[];
}

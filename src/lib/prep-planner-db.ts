/**
 * Prep Planner SQLite — historical demand, weather, and forecast storage.
 *
 * Tables:
 *   prep_demand_history   — one row per (company, product, date, hour) aggregated POS sales
 *   prep_weather_daily    — one row per (date) for Berlin weather
 *   prep_forecasts        — one row per (company, product, target_date, target_hour, run_id)
 *   prep_forecast_runs    — audit log of every cron run
 *
 * Phase 1 populates demand + weather via the cron job at /api/cron/prep-forecast.
 * Forecasts are derived in-process and written to prep_forecasts.
 *
 * Berlin is the single tz for all date/hour fields. Store as plain strings.
 */

import { getDb } from './db';

let _initialized = false;

export function initPrepPlannerTables(): void {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS prep_demand_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      sale_hour INTEGER NOT NULL,
      qty REAL NOT NULL,
      order_count INTEGER NOT NULL,
      dow INTEGER NOT NULL,
      is_holiday INTEGER NOT NULL DEFAULT 0,
      UNIQUE(company_id, product_id, sale_date, sale_hour)
    );
    CREATE INDEX IF NOT EXISTS idx_prep_demand_co_date
      ON prep_demand_history(company_id, sale_date);
    CREATE INDEX IF NOT EXISTS idx_prep_demand_co_prod
      ON prep_demand_history(company_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_prep_demand_dow_hour
      ON prep_demand_history(company_id, product_id, dow, sale_hour);

    CREATE TABLE IF NOT EXISTS prep_weather_daily (
      date TEXT PRIMARY KEY,
      tavg REAL,
      tmax REAL,
      tmin REAL,
      precip_mm REAL,
      snow_cm REAL,
      bucket TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'open-meteo',
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prep_forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      target_date TEXT NOT NULL,
      target_hour INTEGER NOT NULL,
      forecast_qty REAL NOT NULL,
      baseline_qty REAL NOT NULL,
      dow_multiplier REAL NOT NULL DEFAULT 1,
      weather_multiplier REAL NOT NULL DEFAULT 1,
      seasonal_multiplier REAL NOT NULL DEFAULT 1,
      holiday_multiplier REAL NOT NULL DEFAULT 1,
      safety_buffer_pct REAL NOT NULL DEFAULT 0.15,
      sample_size INTEGER NOT NULL DEFAULT 0,
      forecast_run_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(company_id, product_id, target_date, target_hour, forecast_run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prep_fcst_lookup
      ON prep_forecasts(company_id, target_date, target_hour);
    CREATE INDEX IF NOT EXISTS idx_prep_fcst_run
      ON prep_forecasts(forecast_run_id);

    CREATE TABLE IF NOT EXISTS prep_forecast_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      company_ids TEXT NOT NULL,
      lookback_days INTEGER NOT NULL,
      horizon_days INTEGER NOT NULL,
      demand_rows_pulled INTEGER NOT NULL DEFAULT 0,
      forecast_rows_written INTEGER NOT NULL DEFAULT 0,
      weather_rows_pulled INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_prep_runs_started
      ON prep_forecast_runs(started_at);
  `);
  _initialized = true;
}

// ── Types ──────────────────────────────────────────────

export interface DemandRow {
  company_id: number;
  product_id: number;
  product_name: string;
  sale_date: string;
  sale_hour: number;
  qty: number;
  order_count: number;
  dow: number;
  is_holiday: number;
}

export interface WeatherRow {
  date: string;
  tavg: number | null;
  tmax: number | null;
  tmin: number | null;
  precip_mm: number | null;
  snow_cm: number | null;
  bucket: string;
  source: string;
  fetched_at: string;
}

export interface ForecastRow {
  company_id: number;
  product_id: number;
  product_name: string;
  target_date: string;
  target_hour: number;
  forecast_qty: number;
  baseline_qty: number;
  dow_multiplier: number;
  weather_multiplier: number;
  seasonal_multiplier: number;
  holiday_multiplier: number;
  safety_buffer_pct: number;
  sample_size: number;
  forecast_run_id: number;
  created_at: string;
}

export interface ForecastRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  company_ids: string;
  lookback_days: number;
  horizon_days: number;
  demand_rows_pulled: number;
  forecast_rows_written: number;
  weather_rows_pulled: number;
  error_message: string | null;
  duration_ms: number | null;
}

// ── Run lifecycle ──────────────────────────────────────

export function startForecastRun(opts: {
  companyIds: number[];
  lookbackDays: number;
  horizonDays: number;
}): number {
  initPrepPlannerTables();
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO prep_forecast_runs
      (started_at, status, company_ids, lookback_days, horizon_days)
    VALUES (?, 'running', ?, ?, ?)
  `).run(
    new Date().toISOString(),
    JSON.stringify(opts.companyIds),
    opts.lookbackDays,
    opts.horizonDays,
  );
  return result.lastInsertRowid as number;
}

export function finishForecastRun(
  runId: number,
  opts: {
    status: 'success' | 'error';
    demandRowsPulled?: number;
    forecastRowsWritten?: number;
    weatherRowsPulled?: number;
    errorMessage?: string | null;
  },
): void {
  const db = getDb();
  const run = db.prepare('SELECT started_at FROM prep_forecast_runs WHERE id = ?')
    .get(runId) as { started_at: string } | undefined;
  const duration = run
    ? Date.now() - new Date(run.started_at).getTime()
    : null;
  db.prepare(`
    UPDATE prep_forecast_runs
    SET finished_at = ?,
        status = ?,
        demand_rows_pulled = COALESCE(?, demand_rows_pulled),
        forecast_rows_written = COALESCE(?, forecast_rows_written),
        weather_rows_pulled = COALESCE(?, weather_rows_pulled),
        error_message = ?,
        duration_ms = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    opts.status,
    opts.demandRowsPulled ?? null,
    opts.forecastRowsWritten ?? null,
    opts.weatherRowsPulled ?? null,
    opts.errorMessage ?? null,
    duration,
    runId,
  );
}

export function getLatestRun(): ForecastRun | null {
  initPrepPlannerTables();
  const db = getDb();
  return db.prepare(
    'SELECT * FROM prep_forecast_runs ORDER BY started_at DESC LIMIT 1',
  ).get() as ForecastRun | null;
}

// ── Demand history ─────────────────────────────────────

export function upsertDemandRows(rows: DemandRow[]): number {
  if (rows.length === 0) return 0;
  initPrepPlannerTables();
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO prep_demand_history
      (company_id, product_id, product_name, sale_date, sale_hour, qty, order_count, dow, is_holiday)
    VALUES (@company_id, @product_id, @product_name, @sale_date, @sale_hour, @qty, @order_count, @dow, @is_holiday)
    ON CONFLICT(company_id, product_id, sale_date, sale_hour) DO UPDATE SET
      qty = excluded.qty,
      order_count = excluded.order_count,
      product_name = excluded.product_name,
      is_holiday = excluded.is_holiday
  `);
  const tx = db.transaction((data: DemandRow[]) => {
    for (const row of data) stmt.run(row);
  });
  tx(rows);
  return rows.length;
}

export function getDemandHistory(
  companyId: number,
  productId: number,
  fromDate: string,
  toDate: string,
): DemandRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT company_id, product_id, product_name, sale_date, sale_hour,
           qty, order_count, dow, is_holiday
    FROM prep_demand_history
    WHERE company_id = ? AND product_id = ?
      AND sale_date >= ? AND sale_date <= ?
    ORDER BY sale_date, sale_hour
  `).all(companyId, productId, fromDate, toDate) as DemandRow[];
}

export function listProductsWithHistory(
  companyId: number,
  fromDate: string,
  toDate: string,
  minRows: number = 20,
): { product_id: number; product_name: string; row_count: number }[] {
  initPrepPlannerTables();
  const db = getDb();
  return db.prepare(`
    SELECT product_id,
           MAX(product_name) AS product_name,
           COUNT(*) AS row_count
    FROM prep_demand_history
    WHERE company_id = ?
      AND sale_date >= ? AND sale_date <= ?
    GROUP BY product_id
    HAVING COUNT(*) >= ?
    ORDER BY row_count DESC
  `).all(companyId, fromDate, toDate, minRows) as {
    product_id: number;
    product_name: string;
    row_count: number;
  }[];
}

// ── Weather ────────────────────────────────────────────

export function upsertWeatherRows(rows: Omit<WeatherRow, 'fetched_at'>[]): number {
  if (rows.length === 0) return 0;
  initPrepPlannerTables();
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO prep_weather_daily
      (date, tavg, tmax, tmin, precip_mm, snow_cm, bucket, source, fetched_at)
    VALUES (@date, @tavg, @tmax, @tmin, @precip_mm, @snow_cm, @bucket, @source, @fetched_at)
    ON CONFLICT(date) DO UPDATE SET
      tavg = excluded.tavg,
      tmax = excluded.tmax,
      tmin = excluded.tmin,
      precip_mm = excluded.precip_mm,
      snow_cm = excluded.snow_cm,
      bucket = excluded.bucket,
      source = excluded.source,
      fetched_at = excluded.fetched_at
  `);
  const tx = db.transaction((data: Omit<WeatherRow, 'fetched_at'>[]) => {
    for (const row of data) stmt.run({ ...row, fetched_at: now });
  });
  tx(rows);
  return rows.length;
}

export function getWeatherMap(
  fromDate: string,
  toDate: string,
): Map<string, WeatherRow> {
  initPrepPlannerTables();
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM prep_weather_daily
    WHERE date >= ? AND date <= ?
  `).all(fromDate, toDate) as WeatherRow[];
  const out = new Map<string, WeatherRow>();
  for (const r of rows) out.set(r.date, r);
  return out;
}

// ── Forecasts ──────────────────────────────────────────

export function writeForecastRows(rows: ForecastRow[]): number {
  if (rows.length === 0) return 0;
  initPrepPlannerTables();
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO prep_forecasts
      (company_id, product_id, product_name, target_date, target_hour,
       forecast_qty, baseline_qty, dow_multiplier, weather_multiplier,
       seasonal_multiplier, holiday_multiplier, safety_buffer_pct,
       sample_size, forecast_run_id, created_at)
    VALUES (@company_id, @product_id, @product_name, @target_date, @target_hour,
            @forecast_qty, @baseline_qty, @dow_multiplier, @weather_multiplier,
            @seasonal_multiplier, @holiday_multiplier, @safety_buffer_pct,
            @sample_size, @forecast_run_id, @created_at)
    ON CONFLICT(company_id, product_id, target_date, target_hour, forecast_run_id) DO NOTHING
  `);
  const tx = db.transaction((data: ForecastRow[]) => {
    for (const row of data) stmt.run(row);
  });
  tx(rows);
  return rows.length;
}

export function getLatestForecasts(
  companyId: number,
  targetDate: string,
): ForecastRow[] {
  initPrepPlannerTables();
  const db = getDb();
  const latestRun = db.prepare(`
    SELECT id FROM prep_forecast_runs
    WHERE status = 'success'
    ORDER BY started_at DESC LIMIT 1
  `).get() as { id: number } | undefined;
  if (!latestRun) return [];
  return db.prepare(`
    SELECT * FROM prep_forecasts
    WHERE company_id = ? AND target_date = ? AND forecast_run_id = ?
    ORDER BY product_name, target_hour
  `).all(companyId, targetDate, latestRun.id) as ForecastRow[];
}

/**
 * Prune forecast rows older than N days to keep the DB lean.
 * Only touches rows whose target_date is in the past.
 */
export function pruneOldForecasts(keepDays: number = 30): number {
  initPrepPlannerTables();
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const res = db.prepare(
    'DELETE FROM prep_forecasts WHERE target_date < ?',
  ).run(cutoffStr);
  return res.changes;
}

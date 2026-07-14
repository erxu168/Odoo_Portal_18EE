/**
 * Prep Planner forecast engine.
 *
 * Pipeline:
 *   1. backfillDemandHistory    — pull POS order lines from Odoo,
 *                                 aggregate to (company, product, date, hour)
 *                                 in Berlin local tz, upsert to prep_demand_history.
 *   2. backfillWeather          — pull Berlin historical daily weather via
 *                                 Open-Meteo, upsert to prep_weather_daily.
 *                                 Also fetch forecast weather for the horizon.
 *   3. computeForecasts         — per product, compute per-hour forecasts for
 *                                 the next N days using EWMA of same-DOW-hour
 *                                 samples, tagged with holiday + seasonal +
 *                                 weather multipliers. Writes prep_forecasts
 *                                 (POS-product level).
 *   3b. computePrepItemForecasts — Phase 2: project POS-product forecasts onto
 *                                  cook-facing prep_items via prep_pos_link.
 *                                  Writes prep_item_forecasts. No-op for
 *                                  companies with no configured prep_items.
 *
 * Phase 1 computes baseline + seasonal + holiday multipliers.
 * Weather + dow multipliers are stored as 1.0 for now — Phase 2+ will replace
 * them with per-bucket and per-DOW ratios once enough tagged history exists.
 *
 * Algorithm source: Prep Planner Algorithm Design doc, Sections 4.1–4.4.
 * EWMA alpha: 0.85 (heavy on recent samples).
 */

import { getOdoo } from './odoo';
import { berlinToUtc } from './report-queries';
import { isHoliday } from './german-holidays';
import {
  fetchHistoricalWeather,
  fetchForecastWeather,
  dateRange,
  classifyWeather,
  type WeatherDaily,
} from './weather';
import {
  initPrepPlannerTables,
  startForecastRun,
  finishForecastRun,
  upsertDemandRows,
  upsertWeatherRows,
  writeForecastRows,
  getDemandHistory,
  listProductsWithHistory,
  getWeatherMap,
  type DemandRow,
  type ForecastRow,
} from './prep-planner-db';
import { computePrepItemForecasts } from './prep-planner-mapping-db';

// ── Constants ──────────────────────────────────────────

const EWMA_ALPHA = 0.85;
const DEFAULT_SAFETY_BUFFER = 0.15;

// Hours Krawings kitchens are effectively active. Outside this window
// demand is ~0 anyway, and skipping keeps the forecast table lean.
const SERVICE_HOUR_START = 10;
const SERVICE_HOUR_END = 23;

// ── Berlin-aware date helpers ──────────────────────────

/**
 * Parse an Odoo datetime string (UTC, "YYYY-MM-DD HH:MM:SS") and return
 * the Berlin-local calendar date, hour, and day-of-week.
 */
export function utcToBerlinParts(utcStr: string): {
  date: string;
  hour: number;
  dow: number;
} {
  // Odoo returns "2026-04-15 18:30:00" with no TZ marker; it's UTC.
  const d = new Date(utcStr.replace(' ', 'T') + 'Z');
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  let hour = parseInt(get('hour'), 10);
  // Intl sometimes returns "24" for midnight — normalize to 0.
  if (hour === 24) hour = 0;
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dowMap[get('weekday')] ?? 0;
  return { date, hour, dow };
}

function berlinToday(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now); // en-CA gives YYYY-MM-DD
}

function dowOfBerlinDate(dateStr: string): number {
  // Treat as Berlin local midnight.
  const d = new Date(dateStr + 'T00:00:00+01:00'); // offset approximate
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
  });
  const weekday = fmt.format(d);
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return dowMap[weekday] ?? 0;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

function monthOfDate(dateStr: string): number {
  return parseInt(dateStr.substring(5, 7), 10);
}

function yearOfDate(dateStr: string): number {
  return parseInt(dateStr.substring(0, 4), 10);
}

// ── EWMA ───────────────────────────────────────────────

/**
 * Exponentially-weighted moving average.
 * Samples MUST be ordered oldest → newest so recent samples dominate.
 * Alpha=0.85 means "heavy on recent" per the algorithm design doc.
 */
export function ewma(samples: number[], alpha: number = EWMA_ALPHA): number {
  if (samples.length === 0) return 0;
  let s = samples[0];
  for (let i = 1; i < samples.length; i++) {
    s = alpha * samples[i] + (1 - alpha) * s;
  }
  return s;
}

// ── Step 1: Backfill POS demand history ────────────────

interface PosOrderLine {
  id: number;
  order_id: [number, string] | false;
  product_id: [number, string] | false;
  qty: number;
}

interface PosOrderMeta {
  id: number;
  date_order: string;
}

/**
 * Pull POS order lines for `companyId` from `fromDate` to `toDate`
 * (Berlin-local, inclusive), aggregate by (product, date, hour),
 * and upsert to prep_demand_history.
 *
 * Odoo stores pos.order.date_order in UTC. We convert each line's
 * timestamp to Berlin local to bucket it correctly.
 */
export async function backfillDemandHistory(
  companyId: number,
  fromDate: string,
  toDate: string,
): Promise<number> {
  initPrepPlannerTables();
  const odoo = getOdoo();

  // Pull order metadata once so we can resolve each line's date_order.
  const orders = (await odoo.searchRead(
    'pos.order',
    [
      ['company_id', '=', companyId],
      ['date_order', '>=', berlinToUtc(fromDate)],
      ['date_order', '<', berlinToUtc(toDate, true)],
      ['state', 'in', ['paid', 'done', 'invoiced']],
    ],
    ['id', 'date_order'],
    { limit: 0, order: 'date_order asc' },
  )) as PosOrderMeta[];

  if (orders.length === 0) return 0;

  const orderDateMap = new Map<number, string>();
  for (const o of orders) orderDateMap.set(o.id, o.date_order);

  // Pull lines in manageable chunks. Some restaurants have 100k+ lines/year
  // so we page via offset rather than a single massive query.
  const orderIds = orders.map(o => o.id);
  const CHUNK = 500;
  const lines: PosOrderLine[] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const page = (await odoo.searchRead(
      'pos.order.line',
      [['order_id', 'in', chunk]],
      ['order_id', 'product_id', 'qty'],
      { limit: 0 },
    )) as PosOrderLine[];
    lines.push(...page);
  }

  // Aggregate: (product_id, date, hour) → { qty, order_count, product_name }
  type Bucket = {
    product_id: number;
    product_name: string;
    sale_date: string;
    sale_hour: number;
    dow: number;
    qty: number;
    orders: Set<number>;
  };
  const buckets = new Map<string, Bucket>();

  for (const line of lines) {
    if (!line.product_id || !line.order_id) continue;
    const productId = line.product_id[0];
    const productName = line.product_id[1];
    const orderId = line.order_id[0];
    const dateOrder = orderDateMap.get(orderId);
    if (!dateOrder) continue;
    const { date, hour, dow } = utcToBerlinParts(dateOrder);

    const key = `${productId}|${date}|${hour}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        product_id: productId,
        product_name: productName,
        sale_date: date,
        sale_hour: hour,
        dow,
        qty: 0,
        orders: new Set(),
      };
      buckets.set(key, b);
    }
    b.qty += line.qty;
    b.orders.add(orderId);
  }

  const rows: DemandRow[] = [];
  for (const b of Array.from(buckets.values())) {
    const dateObj = new Date(b.sale_date + 'T12:00:00+01:00');
    const holiday = isHoliday(dateObj) !== null;
    rows.push({
      company_id: companyId,
      product_id: b.product_id,
      product_name: b.product_name,
      sale_date: b.sale_date,
      sale_hour: b.sale_hour,
      qty: Math.round(b.qty * 100) / 100,
      order_count: b.orders.size,
      dow: b.dow,
      is_holiday: holiday ? 1 : 0,
    });
  }

  return upsertDemandRows(rows);
}

// ── Step 2: Backfill weather ───────────────────────────

export async function backfillWeather(
  fromDate: string,
  toDate: string,
): Promise<number> {
  initPrepPlannerTables();
  if (fromDate > toDate) return 0;
  const today = berlinToday();
  // Archive only covers up to yesterday in some regions. Clamp if needed.
  const archiveEnd = toDate >= today ? addDays(today, -1) : toDate;
  let historical: WeatherDaily[] = [];
  if (fromDate <= archiveEnd) {
    historical = await fetchHistoricalWeather(fromDate, archiveEnd);
  }
  return upsertWeatherRows(historical.map(h => ({
    date: h.date,
    tavg: h.tavg,
    tmax: h.tmax,
    tmin: h.tmin,
    precip_mm: h.precip_mm,
    snow_cm: h.snow_cm,
    bucket: h.bucket,
    source: 'open-meteo-archive',
  })));
}

export async function backfillForecastWeather(horizonDays: number): Promise<number> {
  initPrepPlannerTables();
  const forecast = await fetchForecastWeather(horizonDays);
  return upsertWeatherRows(forecast.map(h => ({
    date: h.date,
    tavg: h.tavg,
    tmax: h.tmax,
    tmin: h.tmin,
    precip_mm: h.precip_mm,
    snow_cm: h.snow_cm,
    bucket: h.bucket,
    source: 'open-meteo-forecast',
  })));
}

// ── Step 3: Compute forecasts ──────────────────────────

interface SeasonalContext {
  recentAvg: number;     // last 4 weeks, same product
  lastYearAvg: number;   // same 4 weeks, year ago
}

function seasonalMultiplier(ctx: SeasonalContext): number {
  if (ctx.lastYearAvg <= 0.01) return 1;
  const ratio = ctx.recentAvg / ctx.lastYearAvg;
  // Cap to avoid runaway multipliers on sparse products.
  return Math.max(0.3, Math.min(3.0, ratio));
}

/**
 * Compute forecasts for one company across the next `horizonDays`.
 * Writes rows into prep_forecasts under `runId`.
 * Returns the number of rows written.
 */
export async function computeForecasts(
  companyId: number,
  runId: number,
  horizonDays: number,
  lookbackDays: number,
  minRows: number = 20,
): Promise<number> {
  initPrepPlannerTables();
  const today = berlinToday();
  const fromDate = addDays(today, -lookbackDays);
  const yesterday = addDays(today, -1);

  const products = listProductsWithHistory(companyId, fromDate, yesterday, minRows);
  if (products.length === 0) return 0;

  // Weather cache for the horizon (to attach a bucket to each target date).
  const horizonStart = today;
  const horizonEnd = addDays(today, horizonDays - 1);
  const weatherMap = getWeatherMap(horizonStart, horizonEnd);

  const rows: ForecastRow[] = [];
  const now = new Date().toISOString();

  for (const product of products) {
    const history = getDemandHistory(
      companyId,
      product.product_id,
      fromDate,
      yesterday,
    );
    if (history.length === 0) continue;

    // Bucket by (dow, hour) → ordered samples (oldest → newest).
    const bucket = new Map<string, { date: string; qty: number }[]>();
    for (const h of history) {
      const key = `${h.dow}|${h.sale_hour}`;
      let arr = bucket.get(key);
      if (!arr) {
        arr = [];
        bucket.set(key, arr);
      }
      arr.push({ date: h.sale_date, qty: h.qty });
    }
    for (const arr of Array.from(bucket.values())) {
      arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    // Seasonal context: compare last 4 weeks to same 4 weeks a year ago.
    const last4wkStart = addDays(today, -28);
    const ly4wkStart = addDays(today, -28 - 365);
    const ly4wkEnd = addDays(today, -365);

    const recentSum = history
      .filter(h => h.sale_date >= last4wkStart && h.sale_date <= yesterday)
      .reduce((s, h) => s + h.qty, 0);
    const recentDays = new Set(
      history
        .filter(h => h.sale_date >= last4wkStart && h.sale_date <= yesterday)
        .map(h => h.sale_date),
    ).size || 1;

    const lyHistory = getDemandHistory(
      companyId,
      product.product_id,
      ly4wkStart,
      ly4wkEnd,
    );
    const lyDays = new Set(lyHistory.map(h => h.sale_date)).size || 1;
    const lySum = lyHistory.reduce((s, h) => s + h.qty, 0);

    const seasonalCtx: SeasonalContext = {
      recentAvg: recentSum / recentDays,
      lastYearAvg: lySum / lyDays,
    };
    const seasonalMult = seasonalMultiplier(seasonalCtx);

    // For each target date × hour, compute forecast.
    for (let d = 0; d < horizonDays; d++) {
      const targetDate = addDays(today, d);
      const dow = dowOfBerlinDate(targetDate);
      const dateObj = new Date(targetDate + 'T12:00:00+01:00');
      const isHol = isHoliday(dateObj) !== null;
      // Phase 1: holidays are treated as closed (0 demand).
      const holidayMult = isHol ? 0 : 1;

      // Weather bucket for this target date — Phase 1 stores the tag
      // but applies a neutral multiplier. Phase 2 will compute a real
      // bucket-vs-baseline ratio from historical data.
      const weatherRow = weatherMap.get(targetDate);
      const weatherMult = 1;
      const weatherBucketKnown = !!weatherRow;
      void weatherBucketKnown; // reserved for Phase 2 tagging

      for (let hour = SERVICE_HOUR_START; hour <= SERVICE_HOUR_END; hour++) {
        const key = `${dow}|${hour}`;
        const samples = bucket.get(key);
        const sampleQtys = samples ? samples.map(s => s.qty) : [];
        if (sampleQtys.length === 0) continue;
        const baseline = ewma(sampleQtys, EWMA_ALPHA);
        const forecastQty = Math.max(
          0,
          baseline * weatherMult * seasonalMult * holidayMult,
        );

        rows.push({
          company_id: companyId,
          product_id: product.product_id,
          product_name: product.product_name,
          target_date: targetDate,
          target_hour: hour,
          forecast_qty: Math.round(forecastQty * 100) / 100,
          baseline_qty: Math.round(baseline * 100) / 100,
          dow_multiplier: 1,
          weather_multiplier: weatherMult,
          seasonal_multiplier: Math.round(seasonalMult * 1000) / 1000,
          holiday_multiplier: holidayMult,
          safety_buffer_pct: DEFAULT_SAFETY_BUFFER,
          sample_size: sampleQtys.length,
          forecast_run_id: runId,
          created_at: now,
        });
      }
    }
  }

  return writeForecastRows(rows);
}

// ── Public entry point ─────────────────────────────────

export interface ForecastJobOptions {
  companyIds: number[];
  lookbackDays?: number;
  horizonDays?: number;
  skipDemandBackfill?: boolean;
  skipWeather?: boolean;
  /**
   * Minimum number of demand-history rows a product needs to be forecasted.
   * Default 20 (conservative for production). Lower (e.g. 5) for staging
   * environments with sparse POS history.
   */
  minRows?: number;
}

export interface ForecastJobResult {
  runId: number;
  status: 'success' | 'error';
  demandRowsPulled: number;
  weatherRowsPulled: number;
  forecastRowsWritten: number;
  prepItemRowsWritten: number;
  durationMs: number;
  error?: string;
}

export async function runForecastJob(
  opts: ForecastJobOptions,
): Promise<ForecastJobResult> {
  const lookbackDays = opts.lookbackDays ?? 84; // 12 weeks
  const horizonDays = opts.horizonDays ?? 7;
  const runId = startForecastRun({
    companyIds: opts.companyIds,
    lookbackDays,
    horizonDays,
  });
  const startedAt = Date.now();

  let demandRowsPulled = 0;
  let weatherRowsPulled = 0;
  let forecastRowsWritten = 0;
  let prepItemRowsWritten = 0;

  try {
    const today = berlinToday();
    const fromDate = addDays(today, -lookbackDays);
    const yesterday = addDays(today, -1);

    // 1. Demand backfill per company
    if (!opts.skipDemandBackfill) {
      for (const companyId of opts.companyIds) {
        const n = await backfillDemandHistory(companyId, fromDate, yesterday);
        demandRowsPulled += n;
      }
    }

    // 2. Weather backfill — once, shared across companies (all Berlin).
    //    Pull history + next horizon in two calls so we have a full window.
    if (!opts.skipWeather) {
      weatherRowsPulled += await backfillWeather(fromDate, yesterday);
      weatherRowsPulled += await backfillForecastWeather(horizonDays);
    }

    // 3. Forecast computation per company (POS-product level)
    for (const companyId of opts.companyIds) {
      const n = await computeForecasts(
        companyId,
        runId,
        horizonDays,
        lookbackDays,
        opts.minRows,
      );
      forecastRowsWritten += n;
    }

    // 3b. Phase 2 projection: POS-product forecasts → prep-item forecasts.
    //     Silent no-op for companies with no prep_items / prep_pos_link set.
    for (const companyId of opts.companyIds) {
      prepItemRowsWritten += computePrepItemForecasts(companyId, runId);
    }

    finishForecastRun(runId, {
      status: 'success',
      demandRowsPulled,
      forecastRowsWritten,
      weatherRowsPulled,
    });

    return {
      runId,
      status: 'success',
      demandRowsPulled,
      weatherRowsPulled,
      forecastRowsWritten,
      prepItemRowsWritten,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishForecastRun(runId, {
      status: 'error',
      demandRowsPulled,
      forecastRowsWritten,
      weatherRowsPulled,
      errorMessage: msg,
    });
    return {
      runId,
      status: 'error',
      demandRowsPulled,
      weatherRowsPulled,
      forecastRowsWritten,
      prepItemRowsWritten,
      durationMs: Date.now() - startedAt,
      error: msg,
    };
  }
}

// Exported for tests / manual inspection.
export const _private = {
  ewma,
  seasonalMultiplier,
  utcToBerlinParts,
  dowOfBerlinDate,
  addDays,
  monthOfDate,
  yearOfDate,
  classifyWeather,
  dateRange,
  berlinToday,
};

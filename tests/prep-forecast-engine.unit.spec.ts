import { test, expect } from '@playwright/test';
import fs from 'fs'; import os from 'os'; import path from 'path';

/**
 * The two failures that kept the Prep Planner forecast at ZERO rows for its
 * entire life:
 *   1. `limit: 0` in the shared Odoo client silently means "200" — so the
 *      demand backfill only ever saw the oldest 200 POS orders and never
 *      reached the recent history the forecast needed.
 *   2. A free weather API's 502 aborted the whole nightly run — for data the
 *      maths doesn't even use yet (weather multiplier is hardcoded 1.0).
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-prep-'));
process.env.PORTAL_DB_PATH = path.join(dir, 'portal.db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OdooClient } = require('../src/lib/odoo');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const engine = require('../src/lib/prep-planner-engine');

/** Fake Odoo serving ids 1..total, honouring an ['id','>',n] cursor + limit. */
function fakeOdoo(client: unknown, total: number) {
  (client as any).searchRead = async (_m: string, domain: unknown[][], _f: string[], opts: { limit?: number }) => {
    const cursorTerm = domain.find((t) => Array.isArray(t) && t[0] === 'id' && t[1] === '>');
    const after = cursorTerm ? Number(cursorTerm[2]) : 0;
    const limit = opts.limit ?? 200;
    const out: { id: number }[] = [];
    for (let id = after + 1; id <= Math.min(after + limit, total); id++) out.push({ id });
    return out;
  };
}

test('searchReadAll pages past the silent 200-row cap — by id cursor, not offset', async () => {
  // Cursor pagination on purpose: an offset walk over a live table can repeat
  // or skip rows when records land mid-run; an id cursor cannot.
  const client = new OdooClient();
  const TOTAL = 1234;   // three pages at the 500 default
  fakeOdoo(client, TOTAL);
  const all = await client.searchReadAll('pos.order', [], ['id']);
  expect(all.length, 'every row, not just the first page').toBe(TOTAL);
  expect(all[TOTAL - 1].id).toBe(TOTAL);
});

test('searchReadAll REFUSES to return silently truncated data at the backstop', async () => {
  // Returning the first 50k with a console.warn would recreate the exact
  // stale-history bug this method exists to fix.
  const client = new OdooClient();
  fakeOdoo(client, 1200);
  await expect(client.searchReadAll('pos.order', [], ['id'], { maxRows: 1000 }))
    .rejects.toThrow(/backstop/);
  // Non-aligned pageSize/maxRows must not slip through on a short final page.
  const client2 = new OdooClient();
  fakeOdoo(client2, 1250);
  await expect(client2.searchReadAll('pos.order', [], ['id'], { maxRows: 1001 }))
    .rejects.toThrow(/backstop/);
});

test('a weather outage does not kill the forecast run', async () => {
  const origFetch = global.fetch;
  // Every weather call fails, exactly like the Open-Meteo 502s in the logs.
  global.fetch = (() => Promise.reject(new Error('Open-Meteo down'))) as typeof fetch;
  try {
    const res = await engine.runForecastJob({ companyIds: [], skipDemandBackfill: true });
    expect(res.status, 'the run must survive a weather outage').toBe('success');
    expect(res.weatherRowsPulled).toBe(0);
    expect(typeof res.weatherWarning, 'the outage must be SAID, not swallowed').toBe('string');
    expect(res.weatherWarning.length).toBeGreaterThan(0);
  } finally {
    global.fetch = origFetch;
  }
});

test("another company's later run must not hide this company's forecasts", () => {
  // The reader used to pick the GLOBALLY latest successful run — so every
  // empty-but-successful Ssam night instantly hid whatever WAJ forecasts
  // existed. The reader must find the latest run WITH ROWS for the asked
  // company and date.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('../src/lib/prep-planner-db');
  db.initPrepPlannerTables();
  const WAJ = 6, OTHER = 3, DATE = '2027-01-05';

  const runA = db.startForecastRun({ companyIds: [WAJ], lookbackDays: 84, horizonDays: 7 });
  db.writeForecastRows([{
    forecast_run_id: runA, company_id: WAJ, product_id: 901, product_name: 'Jerk Chicken',
    target_date: DATE, target_hour: 18, forecast_qty: 12, baseline_qty: 12,
    dow_multiplier: 1, weather_multiplier: 1, seasonal_multiplier: 1,
    holiday_multiplier: 1, safety_buffer_pct: 0.15, sample_size: 9,
    created_at: new Date().toISOString(),
  }]);
  db.finishForecastRun(runA, { status: 'success', demandRowsPulled: 1, forecastRowsWritten: 1, weatherRowsPulled: 0 });

  // A later successful run for ANOTHER company, writing nothing for WAJ.
  const runB = db.startForecastRun({ companyIds: [OTHER], lookbackDays: 84, horizonDays: 7 });
  db.finishForecastRun(runB, { status: 'success', demandRowsPulled: 0, forecastRowsWritten: 0, weatherRowsPulled: 0 });

  const rows = db.getLatestForecasts(WAJ, DATE);
  expect(rows.length, "run B must not eclipse run A's forecasts").toBe(1);
  expect(rows[0].forecast_qty).toBe(12);
});

test('the run metadata always belongs to the rows being served', () => {
  // The API used to pair company-specific rows with the GLOBALLY latest run —
  // so the screen could caption WAJ's forecasts with another company's newer
  // run time and status.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('../src/lib/prep-planner-db');
  const { run, forecasts } = db.getForecastsWithRun(6, '2027-01-05');
  expect(forecasts.length).toBe(1);
  expect(run, 'metadata must describe the run the rows came from').toBeTruthy();
  expect(run.id).toBe(forecasts[0].forecast_run_id);
});

test('a public holiday forecasts like a normal day — the shop is OPEN', () => {
  // Ethan, 2026-08-01: "we are always open; a few days we are closed which is
  // around christmas and new year." Phase 1 assumed holidays = closed and
  // forecast ZERO for them — silently wrong for every holiday of the year.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('../src/lib/prep-planner-db');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isHoliday } = require('../src/lib/german-holidays');
  db.initPrepPlannerTables();
  const WAJ = 6, PID = 88001, HOUR = 18;

  // Find the next German public holiday from tomorrow on.
  const today = new Date();
  let holiday: Date | null = null;
  for (let i = 1; i <= 370 && !holiday; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    if (isHoliday(new Date(d.toISOString().slice(0, 10) + 'T12:00:00+01:00'))) holiday = d;
  }
  expect(holiday, 'a holiday must exist within a year').toBeTruthy();
  const holidayDate = holiday!.toISOString().slice(0, 10);
  const dow = new Date(holidayDate + 'T12:00:00+01:00').getDay();

  // Four recent same-weekday evenings of solid sales.
  const rows = [];
  for (let w = 1; w <= 4; w++) {
    const d = new Date(today.getTime() - ((today.getDay() - dow + 7) % 7 + 7 * w) * 86400000);
    rows.push({
      company_id: WAJ, product_id: PID, product_name: 'Jerk Chicken', sale_date: d.toISOString().slice(0, 10),
      sale_hour: HOUR, qty: 10, order_count: 8, dow, is_holiday: 0,
    });
  }
  db.upsertDemandRows(rows);

  const runId = db.startForecastRun({ companyIds: [WAJ], lookbackDays: 84, horizonDays: 370 });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { computeForecasts } = require('../src/lib/prep-planner-engine');
  return computeForecasts(WAJ, runId, 370, 84, 1).then(() => {
    db.finishForecastRun(runId, { status: 'success', demandRowsPulled: 4, forecastRowsWritten: 1, weatherRowsPulled: 0 });
    const forecasts = db.getLatestForecasts(WAJ, holidayDate);
    const atHour = forecasts.find((f: any) => f.target_hour === HOUR && f.product_id === PID);
    expect(atHour, 'the holiday must have a forecast row').toBeTruthy();
    expect(atHour.forecast_qty, 'an open shop must not forecast zero').toBeGreaterThan(0);
  });
});

test.afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

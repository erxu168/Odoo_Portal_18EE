export const dynamic = 'force-dynamic';
/**
 * GET /api/cron/prep-forecast?token=<CRON_SECRET>&companies=3,5
 *
 * Runs the Prep Planner Phase 1 forecast job:
 *   1. Pulls the last 84 days of POS order lines per company.
 *   2. Pulls Berlin weather (historical + next 7 days forecast).
 *   3. Computes EWMA-based per-hour forecasts for each product × day,
 *      tagged with seasonal and holiday multipliers.
 *
 * Designed to be called by system cron (nightly at 04:00 Berlin):
 *
 *   0 4 * * * curl -s "http://localhost:3000/api/cron/prep-forecast?token=$CRON_SECRET"
 *
 * Also callable manually during Phase 1 validation. Query params:
 *   token         — required when CRON_SECRET is set
 *   companies     — comma-separated Odoo company IDs (default: 3 = Ssam Korean BBQ)
 *   lookback      — history window in days (default 84)
 *   horizon       — forecast window in days (default 7)
 *   skipWeather   — "1" to skip Open-Meteo calls (useful for debugging)
 *   skipDemand    — "1" to skip POS pull (recompute from existing history)
 */
import { NextResponse } from 'next/server';
import { runForecastJob } from '@/lib/prep-planner-engine';
import { logAudit } from '@/lib/db';

// Default to Ssam Korean BBQ for Phase 1 validation.
// What a Jerk (company_id=5) will be added here once POS data exists on staging.
const DEFAULT_COMPANY_IDS = [3];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const secret = process.env.CRON_SECRET;

  if (secret && token !== secret) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const companiesParam = searchParams.get('companies');
  const companyIds = companiesParam
    ? companiesParam.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite)
    : DEFAULT_COMPANY_IDS;

  const lookbackDays = parseInt(searchParams.get('lookback') || '84', 10);
  const horizonDays = parseInt(searchParams.get('horizon') || '7', 10);
  const skipWeather = searchParams.get('skipWeather') === '1';
  const skipDemandBackfill = searchParams.get('skipDemand') === '1';
  const minRowsRaw = searchParams.get('minRows');
  const minRows = minRowsRaw ? parseInt(minRowsRaw, 10) : undefined;

  if (companyIds.length === 0) {
    return NextResponse.json({ error: 'No valid company IDs' }, { status: 400 });
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays < 7 || lookbackDays > 730) {
    return NextResponse.json({ error: 'lookback must be 7–730' }, { status: 400 });
  }
  if (!Number.isFinite(horizonDays) || horizonDays < 1 || horizonDays > 16) {
    return NextResponse.json({ error: 'horizon must be 1–16' }, { status: 400 });
  }

  try {
    const result = await runForecastJob({
      companyIds,
      lookbackDays,
      horizonDays,
      skipWeather,
      skipDemandBackfill,
      minRows: Number.isFinite(minRows) ? minRows : undefined,
    });

    logAudit({
      action: 'cron_prep_forecast',
      module: 'prep_planner',
      detail: `run=${result.runId} status=${result.status} demand=${result.demandRowsPulled} forecast=${result.forecastRowsWritten} weather=${result.weatherRowsPulled} ms=${result.durationMs}`,
    });

    const httpStatus = result.status === 'success' ? 200 : 500;
    return NextResponse.json(result, { status: httpStatus });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Cron prep-forecast error:', msg);
    logAudit({
      action: 'cron_prep_forecast_error',
      module: 'prep_planner',
      detail: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

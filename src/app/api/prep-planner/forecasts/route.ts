export const dynamic = 'force-dynamic';
/**
 * GET /api/prep-planner/forecasts?companyId=3&date=2026-04-20
 *
 * Returns the latest successful-run forecasts for the given company+date.
 * Phase 1 is read-only — writes happen via the cron job.
 *
 * Response:
 *   {
 *     run: { id, started_at, finished_at, status, ... } | null,
 *     forecasts: ForecastRow[],
 *   }
 */
import { NextResponse } from 'next/server';
import { getLatestForecasts, getLatestRun } from '@/lib/prep-planner-db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyIdRaw = searchParams.get('companyId');
  const date = searchParams.get('date');

  if (!companyIdRaw || !date) {
    return NextResponse.json(
      { error: 'companyId and date (YYYY-MM-DD) are required' },
      { status: 400 },
    );
  }
  const companyId = parseInt(companyIdRaw, 10);
  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: 'companyId must be an integer' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const run = getLatestRun();
    const forecasts = getLatestForecasts(companyId, date);
    return NextResponse.json({ run, forecasts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

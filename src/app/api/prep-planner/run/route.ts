export const dynamic = 'force-dynamic';
/**
 * POST /api/prep-planner/run?companyId=3
 *
 * Manager-only on-demand trigger for the Prep Planner forecast job.
 * Same engine as the nightly cron but authenticated via session, not CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { runForecastJob } from '@/lib/prep-planner-engine';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { logAudit } from '@/lib/db';

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager role required' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const companyIdRaw = searchParams.get('companyId');
  const companyId = companyIdRaw ? parseInt(companyIdRaw, 10) : NaN;
  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: 'companyId required' }, { status: 400 });
  }

  const lookbackDays = parseInt(searchParams.get('lookback') || '84', 10);
  const horizonDays = parseInt(searchParams.get('horizon') || '7', 10);
  const minRowsRaw = searchParams.get('minRows');
  const minRows = minRowsRaw ? parseInt(minRowsRaw, 10) : undefined;
  const skipDemand = searchParams.get('skipDemand') === '1';

  try {
    const result = await runForecastJob({
      companyIds: [companyId],
      lookbackDays,
      horizonDays,
      skipWeather: false,
      skipDemandBackfill: skipDemand,
      minRows: Number.isFinite(minRows) ? minRows : undefined,
    });

    logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'manual_prep_forecast',
      module: 'prep_planner',
      detail: `company=${companyId} run=${result.runId} status=${result.status} ms=${result.durationMs}`,
    });

    const httpStatus = result.status === 'success' ? 200 : 500;
    return NextResponse.json(result, { status: httpStatus });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[prep-planner] manual run error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

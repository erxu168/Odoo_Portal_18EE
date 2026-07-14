/**
 * GET /api/shifts/runs?company_id= — list a company's publish runs.
 * Each run's state reflects the lazy deadline lock: an 'open' run past its
 * deadline reads (and is persisted) as 'locked'. Manager only.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, serverError } from '../_manager';
import { listPublishRuns, setPublishRunState } from '@/lib/shifts-db';
import { effectivePublishState } from '@/lib/shifts-patterns';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    const now = new Date().toISOString();
    const runs = listPublishRuns(auth.companyId).map(run => {
      const state = effectivePublishState(run.state, run.selectDeadline, now);
      if (state === 'locked' && run.state === 'open') {
        setPublishRunState(run.id, auth.companyId, 'locked');
      }
      return { ...run, state };
    });
    return NextResponse.json({ runs });
  } catch (err: unknown) {
    return serverError('GET runs', err);
  }
}

/**
 * GET /api/station/roster?company_id= — read-only "who's on today" for the
 * shared kitchen-tablet station home. Staff-level (names + times only).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getTodayRoster } from '@/lib/station-roster';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    requireAuth();
    const cid = Number(req.nextUrl.searchParams.get('company_id'));
    if (!cid) {
      return NextResponse.json({ error: 'company_id required' }, { status: 400 });
    }
    const roster = await getTodayRoster(cid);
    return NextResponse.json({ roster });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('GET /api/station/roster error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load roster';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

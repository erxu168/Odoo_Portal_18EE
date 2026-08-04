export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, CAP } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { listRequests, playsToday, recentPlays } from '@/lib/music/db';

// GET /api/music/history — plays log + the home screen's KPI numbers.
export async function GET() {
  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  return NextResponse.json({
    ok: true,
    plays: recentPlays(200),
    today: playsToday(),
    pendingRequests: listRequests('pending').length,
  });
}

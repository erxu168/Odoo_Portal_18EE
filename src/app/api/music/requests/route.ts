export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, CAP } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { listRequests } from '@/lib/music/db';

// GET /api/music/requests — the manager's inbox: pending + decided.
export async function GET() {
  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  return NextResponse.json({ ok: true, pending: listRequests('pending'), decided: listRequests('decided') });
}

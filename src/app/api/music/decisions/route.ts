export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, CAP } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { listManualDecisions } from '@/lib/music/db';
import { moduleForbidden } from '@/lib/module-access';

// GET /api/music/decisions — every manual allow/deny, newest first.
export async function GET() {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  return NextResponse.json({ ok: true, decisions: listManualDecisions() });
}

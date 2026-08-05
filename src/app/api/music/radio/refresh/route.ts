export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorize, CAP } from '@/lib/music/access';
import { gateAdapters, jsonError, radioFetchSource } from '@/lib/music/route-helpers';
import { refreshRadioPools } from '@/lib/music/radio';
import { poolDepths, purgeExpiredMetadata, seedDefaultRadioSources } from '@/lib/music/db';
import { moduleForbidden } from '@/lib/module-access';

let lastRefreshAt = 0;

// POST /api/music/radio/refresh — manager-triggered pool maintenance (also the
// first warm-up). Rate-limited: pool refreshes are operational, not a toy.
export async function POST(request: Request) {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const now = Date.now();
  if (now - lastRefreshAt < 60_000) return jsonError(429, 'Just refreshed — try again in a minute.');
  lastRefreshAt = now;

  seedDefaultRadioSources();
  purgeExpiredMetadata();
  const result = await refreshRadioPools(radioFetchSource, gateAdapters);
  return NextResponse.json({ ok: true, ...result, pools: poolDepths() });
}

// GET — pool health for the settings screen.
export async function GET() {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  seedDefaultRadioSources();
  return NextResponse.json({ ok: true, pools: poolDepths() });
}

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorizePlayerDevice } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { getPlayback, listQueue, poolDepths, seedDefaultRadioSources } from '@/lib/music/db';

// GET /api/music/player/state — the tablet's 15s poll: what plays, what's next.
export async function GET() {
  const authz = authorizePlayerDevice();
  if (!authz.ok) return jsonError(authz.status, authz.error);
  seedDefaultRadioSources();
  const depths = poolDepths();
  const poolReady = Object.values(depths).some((d) => d > 0);
  return NextResponse.json({ ok: true, playback: getPlayback(), queue: listQueue(), poolReady });
}

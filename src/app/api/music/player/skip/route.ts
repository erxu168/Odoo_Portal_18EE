export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorizePlayerDevice } from '@/lib/music/access';
import { jsonError, startNextIfIdle } from '@/lib/music/route-helpers';
import { advancePlayback, getPlayback, listQueue } from '@/lib/music/db';

// POST /api/music/player/skip — a human skipped; attributed to the PIN actor.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorizePlayerDevice({ requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const body = await request.json().catch(() => ({}));
  const version = Number(body?.version);
  const videoId = typeof body?.videoId === 'string' && body.videoId ? body.videoId : undefined;
  if (!Number.isInteger(version)) return jsonError(400, 'Bad player event.');

  const adv = advancePlayback(version, 'skip', undefined, authz.actor.name, videoId);
  if (!adv.ok) {
    return NextResponse.json({ ok: true, playback: getPlayback(), queue: listQueue(), stale: true });
  }
  const playback = adv.next ?? await startNextIfIdle();
  return NextResponse.json({ ok: true, playback, queue: listQueue() });
}

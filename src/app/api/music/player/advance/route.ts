export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorizePlayerDevice } from '@/lib/music/access';
import { jsonError, startNextIfIdle } from '@/lib/music/route-helpers';
import { advancePlayback, getPlayback, listQueue, markUnplayable } from '@/lib/music/db';

const IFRAME_ERRORS = new Set(['e2', 'e5', 'e100', 'e101', 'e150', 'e153']);

// POST /api/music/player/advance — the IFrame said ENDED or errored. Carries
// the playback version it observed; stale/duplicate events are no-ops.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorizePlayerDevice();
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const body = await request.json().catch(() => ({}));
  const version = Number(body?.version);
  const event = body?.event === 'ended' ? 'ended' : body?.event === 'error' ? 'error' : null;
  if (!Number.isInteger(version) || !event) return jsonError(400, 'Bad player event.');
  const errorCode = event === 'error' && typeof body?.errorCode === 'string' && IFRAME_ERRORS.has(body.errorCode)
    ? body.errorCode : event === 'error' ? 'e_unknown' : undefined;

  const current = getPlayback();
  const adv = advancePlayback(version, event, errorCode);
  if (!adv.ok) {
    // Stale = someone else already advanced; just report the current state.
    return NextResponse.json({ ok: true, playback: getPlayback(), queue: listQueue(), stale: true });
  }
  if (event === 'error' && current?.video_id && (errorCode === 'e101' || errorCode === 'e150' || errorCode === 'e153')) {
    markUnplayable(current.video_id);
  }
  const playback = adv.next ?? await startNextIfIdle();
  return NextResponse.json({ ok: true, playback, queue: listQueue() });
}

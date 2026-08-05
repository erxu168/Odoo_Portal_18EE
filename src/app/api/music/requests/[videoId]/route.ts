export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorize, CAP } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { getDb, logAudit } from '@/lib/db';
import { ALL_GENRES, getManualDecision, resolveRequest, setManualDecision, type MusicGenre } from '@/lib/music/db';
import { moduleForbidden } from '@/lib/module-access';

// PATCH /api/music/requests/[videoId] — approve (with a genre shelf) or reject.
// Decision + request resolve atomically; the manual decision is permanent
// (reversible on the Decisions screen, with confirmation).
export async function PATCH(request: Request, { params }: { params: { videoId: string } }) {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const videoId = params.videoId;
  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  if (action !== 'approve' && action !== 'deny') return jsonError(400, 'Choose approve or reject.');

  let genre: MusicGenre | null = null;
  if (action === 'approve') {
    genre = (ALL_GENRES as string[]).includes(body?.genre) ? (body.genre as MusicGenre) : null;
    if (!genre) return jsonError(400, 'Pick which genre shelf the song goes on.');
  }

  const before = getManualDecision(videoId);
  const tx = getDb().transaction(() => {
    setManualDecision({
      videoId,
      decision: action === 'approve' ? 'allow' : 'deny',
      genre,
      reason: action === 'approve' ? 'approved from request' : 'rejected from request',
      byUserId: authz.actor.userId,
      byName: authz.actor.name,
    });
    resolveRequest(videoId, action === 'approve' ? 'approved' : 'denied', authz.actor.name);
    logAudit({
      user_id: authz.actor.userId, user_name: authz.actor.name,
      action: action === 'approve' ? 'music.request.approve' : 'music.request.deny', module: 'music',
      detail: `${videoId}: ${before ? `${before.decision}${before.genre ? '/' + before.genre : ''} → ` : ''}${action === 'approve' ? `allow/${genre}` : 'deny'}`,
    });
  });
  tx();
  return NextResponse.json({ ok: true });
}

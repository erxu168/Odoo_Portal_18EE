export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorize, CAP } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { getDb, logAudit } from '@/lib/db';
import { ALL_GENRES, getManualDecision, setManualDecision, type MusicGenre } from '@/lib/music/db';
import { moduleForbidden } from '@/lib/module-access';

// PATCH /api/music/decisions/[videoId] — reverse a permanent decision
// (the UI asks for confirmation; the row keeps who/when for the audit trail).
export async function PATCH(request: Request, { params }: { params: { videoId: string } }) {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const body = await request.json().catch(() => ({}));
  const decision = body?.decision;
  if (decision !== 'allow' && decision !== 'deny') return jsonError(400, 'Choose allow or deny.');
  let genre: MusicGenre | null = null;
  if (decision === 'allow') {
    genre = (ALL_GENRES as string[]).includes(body?.genre) ? (body.genre as MusicGenre) : null;
    if (!genre) return jsonError(400, 'Pick which genre shelf the song goes on.');
  }
  const before = getManualDecision(params.videoId);
  const tx = getDb().transaction(() => {
    setManualDecision({
      videoId: params.videoId, decision, genre,
      reason: 'reversed on the decisions screen',
      byUserId: authz.actor.userId, byName: authz.actor.name,
    });
    logAudit({
      user_id: authz.actor.userId, user_name: authz.actor.name,
      action: 'music.decision.set', module: 'music',
      detail: `${params.videoId}: ${before ? `${before.decision}${before.genre ? '/' + before.genre : ''} → ` : ''}${decision}${genre ? '/' + genre : ''}`,
    });
  });
  tx();
  return NextResponse.json({ ok: true });
}

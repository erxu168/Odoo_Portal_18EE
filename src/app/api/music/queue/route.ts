export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorizePlayerDevice } from '@/lib/music/access';
import { COPY, gateAdapters, jsonError } from '@/lib/music/route-helpers';
import { gateVideo } from '@/lib/music/gate';
import { enqueue, getMetadata, listQueue, upsertRequest } from '@/lib/music/db';
import { moduleForbidden } from '@/lib/module-access';

// POST /api/music/queue — a staff pick. Client sends ONLY {videoId, idempotencyKey};
// title/channel come from our own metadata, never from the browser.
export async function POST(request: Request) {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorizePlayerDevice({ requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const body = await request.json().catch(() => ({}));
  const videoId = typeof body?.videoId === 'string' ? body.videoId.trim() : '';
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!/^[\w-]{8,24}$/.test(videoId) || idempotencyKey.length < 8) {
    return jsonError(400, 'Pick a song from the search results.');
  }

  const gate = await gateVideo(videoId, gateAdapters);
  if (gate.verdict === 'outage') return jsonError(503, COPY.outage);
  if (gate.verdict === 'unplayable') return NextResponse.json({ ok: false, refused: true, message: COPY.unplayable }, { status: 403 });
  if (gate.verdict === 'deny') return NextResponse.json({ ok: false, refused: true, message: COPY.refused }, { status: 403 });

  const meta = getMetadata(videoId);
  if (gate.verdict === 'unsure') {
    upsertRequest({ videoId, title: meta?.title ?? videoId, channel: meta?.channelTitle ?? '', byName: authz.actor.name });
    return NextResponse.json({ ok: false, refused: true, requested: true, message: COPY.requested }, { status: 403 });
  }

  const res = enqueue({
    videoId,
    title: meta?.title ?? 'Approved song',
    channel: meta?.channelTitle ?? '',
    genre: gate.genre,
    byUserId: authz.actor.userId,
    byName: authz.actor.name,
    idempotencyKey,
  });
  if (!res.ok) {
    if (res.reason === 'duplicate') return NextResponse.json({ ok: true, queued: true, duplicate: true });
    if (res.reason === 'already_queued') return jsonError(409, 'That song is already coming up.');
    return jsonError(409, 'The queue is full (50 songs) — let it play down a bit.');
  }
  return NextResponse.json({ ok: true, queued: true, position: res.position, queue: listQueue() });
}

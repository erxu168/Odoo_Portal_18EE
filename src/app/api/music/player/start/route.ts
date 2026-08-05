export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorizePlayerDevice } from '@/lib/music/access';
import { jsonError, startNextIfIdle } from '@/lib/music/route-helpers';
import { listQueue } from '@/lib/music/db';
import { moduleForbidden } from '@/lib/module-access';

// POST /api/music/player/start — boot / resume: start the queue head or a
// radio pick if nothing is playing. Idempotent — safe to call on every load.
export async function POST(request: Request) {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorizePlayerDevice();
  if (!authz.ok) return jsonError(authz.status, authz.error);
  const playback = await startNextIfIdle();
  return NextResponse.json({ ok: true, playback, queue: listQueue() });
}

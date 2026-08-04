export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorizePlayerDevice } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { searchSongs } from '@/lib/music/catalog';
import { getGateCache, getManualDecision } from '@/lib/music/db';

// GET /api/music/search?q= — catalog search from the jukebox tablet, with the
// cached verdict attached so results can show their door-policy badge.
export async function GET(request: Request) {
  const authz = authorizePlayerDevice();
  if (!authz.ok) return jsonError(authz.status, authz.error);
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });

  const songs = await searchSongs(q);
  if (songs === 'outage') {
    return jsonError(503, 'Song search is taking a break — the radio keeps playing.');
  }
  const results = songs.map((s) => {
    const manual = getManualDecision(s.videoId);
    const cached = manual ? null : getGateCache(s.videoId);
    const verdict = manual?.decision ?? cached?.decision ?? null;
    return { ...s, verdict };
  });
  return NextResponse.json({ ok: true, results });
}

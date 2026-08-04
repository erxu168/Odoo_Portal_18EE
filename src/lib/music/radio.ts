/**
 * WAJ Radio — the automatic station (plays when the queue is empty).
 *
 * Discovery, gating and selection stay separate (spec §8):
 *  - refreshRadioPools() pulls each source via the catalog adapter; an empty or
 *    implausible parse NEVER replaces last-known-good (transactional replace).
 *  - nextRadioTrack() picks least-recently-played genre → shuffled candidates →
 *    skips anything queued / just played (last 50 plays or 12 h) → every
 *    candidate passes the SAME gate as staff picks. Fallback ladder: pools →
 *    manually approved songs. Null only on a truly cold start.
 * Nothing here depends on a live InnerTube call at track-transition time.
 */
import {
  ALL_GENRES, lastPlayedByGenre, listManualAllowFallback, listRadioSources,
  poolCandidates, queuedVideoIds, recentNoRepeatIds, replaceRadioPool,
  getPlayback,
  type MusicGenre, type RadioPick,
} from '@/lib/music/db';
import { gateVideo, type GateAdapters } from '@/lib/music/gate';
import type { CatalogSong } from '@/lib/music/catalog';

const PLAUSIBLE_MIN = 5;       // fewer results than this = parser breakage, keep last-known-good
const GATE_ATTEMPTS_PER_CALL = 15;

export type FetchSource = (sourceType: 'playlist' | 'search', idOrQuery: string) => Promise<CatalogSong[] | 'outage'>;

export async function refreshRadioPools(fetchSource: FetchSource): Promise<{ refreshed: number; kept: number }> {
  let refreshed = 0;
  let kept = 0;
  for (const src of listRadioSources()) {
    const items = await fetchSource(src.source_type, src.browse_or_playlist_id);
    if (items === 'outage' || items.length < PLAUSIBLE_MIN) {
      kept += 1;
      if (items !== 'outage') console.warn(`[music] source ${src.id} (${src.label}) returned ${items.length} items — keeping last-known-good`);
      continue;
    }
    replaceRadioPool(src.id, items.map((s) => ({ videoId: s.videoId, title: s.title, channel: s.artist })));
    refreshed += 1;
  }
  return { refreshed, kept };
}

/** Least-recently-played first; never-played genres lead. */
export function genreRotation(): MusicGenre[] {
  const last = lastPlayedByGenre();
  return [...ALL_GENRES].sort((a, b) => {
    const ta = last[a] ?? '';
    const tb = last[b] ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function nextRadioTrack(a: GateAdapters, rng: () => number = Math.random): Promise<RadioPick | null> {
  const exclude = recentNoRepeatIds();
  Array.from(queuedVideoIds()).forEach((id) => exclude.add(id));
  const current = getPlayback();
  if (current?.video_id) exclude.add(current.video_id);

  let attempts = 0;
  const refused = new Set<string>();
  const consider = async (picks: RadioPick[], opts?: { ignoreNoRepeat?: boolean }): Promise<RadioPick | null> => {
    for (const pick of picks) {
      if (refused.has(pick.videoId)) continue;
      if (!opts?.ignoreNoRepeat && exclude.has(pick.videoId)) continue;
      if (attempts >= GATE_ATTEMPTS_PER_CALL) return null;
      attempts += 1;
      const gate = await gateVideo(pick.videoId, a, { title: pick.title, channel: pick.channel });
      if (gate.verdict === 'allow') return { ...pick, genre: gate.genre };
      refused.add(pick.videoId); // don't re-gate a refused candidate this call
    }
    return null;
  };

  for (const genre of genreRotation()) {
    const candidates = shuffle(poolCandidates(genre), rng).map((c) => ({ videoId: c.videoId, genre, title: c.title, channel: c.channel }));
    const pick = await consider(candidates);
    if (pick) return pick;
    if (attempts >= GATE_ATTEMPTS_PER_CALL) break;
  }

  // Last resort: songs a manager explicitly approved. If even those are all in
  // the no-repeat window, repeat rather than fall silent — but never play
  // something that's queued or refused, and never the song playing right now.
  const queuedNow = queuedVideoIds();
  if (current?.video_id) queuedNow.add(current.video_id);
  const manual = shuffle(listManualAllowFallback(), rng).filter((m) => !queuedNow.has(m.videoId));
  const strictPick = await consider(manual);
  if (strictPick) return strictPick;
  return consider(manual, { ignoreNoRepeat: true });
}

/**
 * WAJ Radio — shared plumbing for the API routes: JSON errors, the wired
 * (real) gate adapters, and the user-facing refusal copy in one place.
 */
import { NextResponse } from 'next/server';
import { fetchVideoData } from '@/lib/music/youtube-data';
import { classify } from '@/lib/music/classifier';
import { fetchSourceVideos } from '@/lib/music/catalog';
import type { GateAdapters } from '@/lib/music/gate';
import { nextRadioTrack, type FetchSource } from '@/lib/music/radio';
import { getPlayback, listQueue, startPlayback, type Playback } from '@/lib/music/db';

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export const gateAdapters: GateAdapters = {
  fetchVideoData: (ids) => fetchVideoData(ids),
  classify: (i) => classify(i),
};

export const radioFetchSource: FetchSource = (t, id) => fetchSourceVideos(t, id);

export const COPY = {
  refused: 'Not the What A Jerk vibe 🌴',
  requested: 'Not the What A Jerk vibe 🌴 — sent to the manager to review.',
  unplayable: "That video can't be played here — pick another version.",
  outage: "Couldn't check this song — try again in a minute.",
} as const;

/**
 * Idempotent "make sound happen": if something is already playing, return it;
 * otherwise start the queue head, else a radio pick, else stay idle (cold
 * start — the player explains). Used by boot/start, advance and skip.
 */
export async function startNextIfIdle(): Promise<Playback | null> {
  const cur = getPlayback();
  if (cur?.state === 'playing') return cur;
  const observed = cur?.version ?? 0;
  const q = listQueue();
  if (q.length > 0) {
    const head = q[0];
    const started = startPlayback({ videoId: head.video_id, source: 'manual', queueId: head.id, genre: head.genre, title: head.title, channel: head.channel }, observed);
    return started ?? getPlayback(); // CAS lost — someone else started; report theirs
  }
  // Radio selection can take a moment (gate calls). Compare-and-swap on the
  // version we observed so a song queued DURING the await is never clobbered.
  const pick = await nextRadioTrack(gateAdapters);
  if (!pick) return getPlayback();
  const started = startPlayback({ videoId: pick.videoId, source: 'radio', queueId: null, genre: pick.genre, title: pick.title, channel: pick.channel }, observed);
  return started ?? getPlayback();
}

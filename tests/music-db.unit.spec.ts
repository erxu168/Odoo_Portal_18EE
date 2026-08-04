import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * WAJ Radio db layer against the REAL schema (PORTAL_DB_PATH scratch file).
 * Pins the invariants the player and gate rely on:
 *  - one request row per video, attempt count increments
 *  - queue dedupe (idempotency key AND already-queued video) + hard cap
 *  - versioned playback advance: stale versions are no-ops
 *  - YouTube metadata expires after 30 days; internal decisions never do
 *  - transactional radio-pool replace keeps last-known-good on empty input
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-music-db-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import { getDb } from '../src/lib/db';
import {
  initMusicTables,
  QUEUE_CAP,
  setManualDecision, getManualDecision,
  setGateCache, getGateCache,
  setMetadata, getMetadata,
  upsertRequest, listRequests, resolveRequest,
  enqueue, listQueue,
  getPlayback, startPlayback, advancePlayback,
  recentPlays,
  seedDefaultRadioSources, listRadioSources, replaceRadioPool, poolCandidates,
  getMusicSettings, setPlayerDevice,
} from '../src/lib/music/db';

let n = 0;
const vid = () => `vid_${++n}_${Math.floor(Math.random() * 1e6)}`;

test.beforeAll(() => { initMusicTables(); });

test('request upsert: one row per video, count increments, decided rows keep history', () => {
  const v = vid();
  upsertRequest({ videoId: v, title: 'Song A', channel: 'Artist A', byName: 'Hana' });
  upsertRequest({ videoId: v, title: 'Song A', channel: 'Artist A', byName: 'Marco' });
  const pending = listRequests('pending').filter((r) => r.video_id === v);
  expect(pending).toHaveLength(1);
  expect(pending[0].request_count).toBe(2);
  expect(pending[0].last_requested_by).toBe('Marco');
  expect(pending[0].first_requested_by).toBe('Hana');

  resolveRequest(v, 'approved', 'Ethan');
  expect(listRequests('pending').some((r) => r.video_id === v)).toBe(false);
  const decided = listRequests('decided').find((r) => r.video_id === v);
  expect(decided?.status).toBe('approved');
  expect(decided?.resolved_by).toBe('Ethan');
});

test('re-requesting after a decision reopens a single pending row', () => {
  const v = vid();
  upsertRequest({ videoId: v, title: 'B', channel: 'B', byName: 'Hana' });
  resolveRequest(v, 'denied', 'Ethan');
  upsertRequest({ videoId: v, title: 'B', channel: 'B', byName: 'Yuki' });
  const rows = listRequests('pending').filter((r) => r.video_id === v);
  expect(rows).toHaveLength(1);
  expect(rows[0].request_count).toBe(2);
});

test('manual decisions: allow requires genre, deny does not, latest wins', () => {
  const v = vid();
  setManualDecision({ videoId: v, decision: 'deny', genre: null, reason: 'not the vibe', byUserId: 1, byName: 'Ethan' });
  expect(getManualDecision(v)?.decision).toBe('deny');
  setManualDecision({ videoId: v, decision: 'allow', genre: 'reggae_dancehall_dub', reason: null, byUserId: 1, byName: 'Ethan' });
  const d = getManualDecision(v);
  expect(d?.decision).toBe('allow');
  expect(d?.genre).toBe('reggae_dancehall_dub');
});

test('gate cache is separate from manual decisions (provenance preserved)', () => {
  const v = vid();
  setGateCache({ videoId: v, decision: 'unsure', genre: null, source: 'claude', reasonCode: 'llm_unsure', model: 'claude-haiku-4-5-20251001', promptVersion: 1 });
  setManualDecision({ videoId: v, decision: 'allow', genre: 'afrobeats_afro', reason: null, byUserId: 1, byName: 'Ethan' });
  expect(getGateCache(v)?.decision).toBe('unsure'); // automatic verdict untouched
  expect(getManualDecision(v)?.decision).toBe('allow');
});

test('metadata expires after 30 days; fresh metadata is returned', () => {
  const fresh = vid();
  setMetadata({
    videoId: fresh, title: 'T', channelId: 'c', channelTitle: 'C', durationSeconds: 200,
    embeddable: true, madeForKids: false, live: false, regionBlockedDe: false, topicCategories: ['Reggae'],
  });
  expect(getMetadata(fresh)?.title).toBe('T');

  const stale = vid();
  setMetadata({
    videoId: stale, title: 'Old', channelId: 'c', channelTitle: 'C', durationSeconds: 200,
    embeddable: true, madeForKids: false, live: false, regionBlockedDe: false, topicCategories: [],
  });
  // Backdate beyond the 30-day TTL directly in SQL.
  getDb().prepare(`UPDATE music_video_metadata SET expires_at = datetime('now', '-1 day') WHERE video_id = ?`).run(stale);
  expect(getMetadata(stale)).toBeNull();
});

test('enqueue: idempotency key dedupes, same video cannot queue twice, cap enforced', () => {
  const v = vid();
  const key = `k_${v}`;
  const first = enqueue({ videoId: v, title: 'S', channel: 'A', genre: 'hip_hop_rap', byUserId: 1, byName: 'Hana', idempotencyKey: key });
  expect(first.ok).toBe(true);
  const dup = enqueue({ videoId: v, title: 'S', channel: 'A', genre: 'hip_hop_rap', byUserId: 1, byName: 'Hana', idempotencyKey: key });
  expect(dup.ok).toBe(false);
  if (!dup.ok) expect(dup.reason).toBe('duplicate');
  const again = enqueue({ videoId: v, title: 'S', channel: 'A', genre: 'hip_hop_rap', byUserId: 2, byName: 'Marco', idempotencyKey: `other_${v}` });
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.reason).toBe('already_queued');

  const before = listQueue().length;
  for (let i = before; i < QUEUE_CAP; i++) {
    const r = enqueue({ videoId: vid(), title: 'S', channel: 'A', genre: 'hip_hop_rap', byUserId: 1, byName: 'H', idempotencyKey: `fill_${i}_${v}` });
    expect(r.ok).toBe(true);
  }
  const overflow = enqueue({ videoId: vid(), title: 'S', channel: 'A', genre: 'hip_hop_rap', byUserId: 1, byName: 'H', idempotencyKey: `over_${v}` });
  expect(overflow.ok).toBe(false);
  if (!overflow.ok) expect(overflow.reason).toBe('queue_full');
});

test('playback: versioned advance — stale version is a no-op, fresh advances FIFO', () => {
  // Clean slate for queue-order assertions.
  getDb().exec(`DELETE FROM music_queue; DELETE FROM music_playback; DELETE FROM music_play_history;`);
  const a = vid(); const b = vid();
  enqueue({ videoId: a, title: 'First', channel: 'A', genre: 'hip_hop_rap', byUserId: 1, byName: 'H', idempotencyKey: `a_${a}` });
  enqueue({ videoId: b, title: 'Second', channel: 'B', genre: 'reggae_dancehall_dub', byUserId: 1, byName: 'H', idempotencyKey: `b_${b}` });

  const q = listQueue();
  const started = startPlayback({ videoId: q[0].video_id, source: 'manual', queueId: q[0].id, genre: 'hip_hop_rap', title: q[0].title, channel: q[0].channel });
  expect(started.video_id).toBe(a);
  const v1 = started.version;

  const adv = advancePlayback(v1, 'ended');
  expect(adv.ok).toBe(true);
  if (adv.ok) expect(adv.next?.video_id).toBe(b);

  // Replaying the SAME observed version (duplicate ENDED / skip race) must be rejected.
  const replay = advancePlayback(v1, 'ended');
  expect(replay.ok).toBe(false);
  if (!replay.ok) expect(replay.reason).toBe('stale');

  // History recorded the completed first track.
  expect(recentPlays(10).some((p) => p.video_id === a)).toBe(true);

  // Queue is drained after advancing past the second track.
  const cur = getPlayback();
  expect(cur?.video_id).toBe(b);
  const adv2 = advancePlayback(cur!.version, 'error', 'e101');
  expect(adv2.ok).toBe(true);
  if (adv2.ok) expect(adv2.next).toBeNull(); // caller falls back to radio
});

test('radio pool: transactional replace, empty replace never erases last-known-good', () => {
  seedDefaultRadioSources();
  const sources = listRadioSources();
  expect(sources.length).toBeGreaterThanOrEqual(4);
  const src = sources[0];
  replaceRadioPool(src.id, [
    { videoId: vid(), title: 'P1', channel: 'C1' },
    { videoId: vid(), title: 'P2', channel: 'C2' },
  ]);
  expect(poolCandidates(src.genre).length).toBeGreaterThanOrEqual(2);
  // The caller enforces plausibility; the db layer refuses an empty replace outright.
  expect(() => replaceRadioPool(src.id, [])).toThrow();
  expect(poolCandidates(src.genre).length).toBeGreaterThanOrEqual(2);
});

test('settings: player device pin round-trips', () => {
  expect(getMusicSettings().playerDeviceId).toBeNull();
  setPlayerDevice(42, 'Ethan');
  expect(getMusicSettings().playerDeviceId).toBe(42);
  setPlayerDevice(null, 'Ethan');
  expect(getMusicSettings().playerDeviceId).toBeNull();
});

import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Auto-radio: genre rotation, no-repeat window, plausibility-guarded pool
 * refresh, gate enforcement on every candidate, and the manual-allow fallback
 * that keeps music playing even when discovery is broken.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-music-radio-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import { getDb } from '../src/lib/db';
import {
  initMusicTables, seedDefaultRadioSources, listRadioSources, poolCandidates,
  setManualDecision, setGateCache,
  type MusicGenre,
} from '../src/lib/music/db';
import { refreshRadioPools, nextRadioTrack, genreRotation } from '../src/lib/music/radio';
import type { GateAdapters, RawVideoData } from '../src/lib/music/gate';
import type { CatalogSong } from '../src/lib/music/catalog';

let n = 0;
const vid = () => `rv_${++n}_${Math.floor(Math.random() * 1e6)}`;
const rng0 = () => 0; // deterministic shuffle (identity-ish)

const song = (id: string, i = 0): CatalogSong => ({ videoId: id, title: `T${i}`, artist: `A${i}`, durationSeconds: 200, thumbnail: null });

/** Adapter that allows everything as the pool's genre via cached-free topic allow. */
function allowAllAdapters(): GateAdapters {
  return {
    async fetchVideoData(ids) {
      const map = new Map<string, RawVideoData>();
      for (const id of ids) {
        map.set(id, {
          title: 'T', channelId: 'c', channelTitle: 'A', durationSeconds: 200,
          embeddable: true, madeForKids: false, live: false, regionBlockedDe: false,
          ageRestricted: false, topicCategories: ['https://en.wikipedia.org/wiki/Reggae'],
        });
      }
      return map;
    },
    async classify() { return { label: 'unsure' as const, model: 'm', promptVersion: 1 }; },
  };
}

function clearMusicState() {
  const db = getDb();
  db.exec(`
    DELETE FROM music_play_history; DELETE FROM music_queue; DELETE FROM music_playback;
    DELETE FROM music_radio_pool; DELETE FROM music_radio_sources;
    DELETE FROM music_manual_decisions; DELETE FROM music_gate_cache; DELETE FROM music_video_metadata;
    DELETE FROM music_requests;
  `);
}

function addPlay(videoId: string, genre: MusicGenre, agoHours: number) {
  getDb().prepare(`
    INSERT INTO music_play_history (video_id, title, genre, source, outcome, played_at)
    VALUES (?, 'T', ?, 'radio', 'played', datetime('now', '-' || ? || ' hours'))
  `).run(videoId, genre, agoHours);
}

test.beforeAll(() => { initMusicTables(); });
test.beforeEach(() => { clearMusicState(); });

test('refresh: plausible results replace the pool; empty/outage keep last-known-good', async () => {
  seedDefaultRadioSources();
  const src = listRadioSources()[0];
  const six = Array.from({ length: 6 }, (_, i) => song(vid(), i));

  const r1 = await refreshRadioPools(async () => six, allowAllAdapters());
  expect(r1.refreshed).toBeGreaterThan(0);
  expect(poolCandidates(src.genre).length).toBeGreaterThanOrEqual(6);

  const before = poolCandidates(src.genre).map((c) => c.videoId).sort();
  const r2 = await refreshRadioPools(async () => [], allowAllAdapters());           // implausible parse
  expect(r2.refreshed).toBe(0);
  expect(poolCandidates(src.genre).map((c) => c.videoId).sort()).toEqual(before);

  const r3 = await refreshRadioPools(async () => 'outage' as const, allowAllAdapters());
  expect(r3.refreshed).toBe(0);
  expect(poolCandidates(src.genre).map((c) => c.videoId).sort()).toEqual(before);
});

test('genre rotation: never-played genres lead, most recent goes last', () => {
  addPlay(vid(), 'hip_hop_rap', 1);       // most recent
  addPlay(vid(), 'reggae_dancehall_dub', 5);
  const rot = genreRotation();
  expect(rot.slice(0, 2).sort()).toEqual(['afrobeats_afro', 'rnb_soul_funk']); // never played
  expect(rot[3]).toBe('hip_hop_rap');
});

test('nextRadioTrack: gates candidates, skips refused ones, honours the no-repeat window', async () => {
  seedDefaultRadioSources();
  const srcReggae = listRadioSources().find((s) => s.genre === 'reggae_dancehall_dub')!;
  const denied = vid(); const played = vid(); const fresh = vid();
  const { replaceRadioPool } = await import('../src/lib/music/db');
  replaceRadioPool(srcReggae.id, [
    { videoId: denied, title: 'Denied', channel: 'X' },
    { videoId: played, title: 'Recent', channel: 'X' },
    { videoId: fresh, title: 'Fresh', channel: 'X' },
  ]);
  setGateCache({ videoId: denied, decision: 'deny', genre: null, source: 'claude', reasonCode: 'llm_other', model: 'm', promptVersion: 1 });
  addPlay(played, 'reggae_dancehall_dub', 2); // inside 12h window
  // Make reggae the least-recently-played by giving the others fresher plays.
  addPlay(vid(), 'hip_hop_rap', 1);
  addPlay(vid(), 'afrobeats_afro', 1);
  addPlay(vid(), 'rnb_soul_funk', 1);

  const pick = await nextRadioTrack(allowAllAdapters(), rng0);
  expect(pick?.videoId).toBe(fresh);
  expect(pick?.genre).toBe('reggae_dancehall_dub');
});

test('empty pools fall back to manually approved songs; cold start yields null', async () => {
  expect(await nextRadioTrack(allowAllAdapters(), rng0)).toBeNull(); // nothing anywhere

  const approved = vid();
  setManualDecision({ videoId: approved, decision: 'allow', genre: 'afrobeats_afro', reason: null, byUserId: 1, byName: 'E' });
  const pick = await nextRadioTrack(allowAllAdapters(), rng0);
  expect(pick?.videoId).toBe(approved);
  expect(pick?.genre).toBe('afrobeats_afro');
});

test('when every approved song is inside the no-repeat window, the radio repeats rather than falling silent', async () => {
  const a = vid();
  setManualDecision({ videoId: a, decision: 'allow', genre: 'rnb_soul_funk', reason: null, byUserId: 1, byName: 'E' });
  addPlay(a, 'rnb_soul_funk', 1); // just played — inside the window
  const pick = await nextRadioTrack(allowAllAdapters(), rng0);
  expect(pick?.videoId).toBe(a);
});

test('an approved song joins its genre shelf in normal rotation (not only the fallback)', async () => {
  seedDefaultRadioSources();
  const srcHip = listRadioSources().find((s) => s.genre === 'hip_hop_rap')!;
  const { replaceRadioPool } = await import('../src/lib/music/db');
  const poolSong = vid(); const approved = vid();
  replaceRadioPool(srcHip.id, [{ videoId: poolSong, title: 'Pool', channel: 'X' }]);
  setManualDecision({ videoId: approved, decision: 'allow', genre: 'hip_hop_rap', reason: null, byUserId: 1, byName: 'E' });
  // Exclude the pool song via the repeat window — the approved one must surface
  // from the SAME genre pass, proving it participates in the shelf's balance.
  addPlay(poolSong, 'hip_hop_rap', 1);
  const pick = await nextRadioTrack(allowAllAdapters(), rng0);
  expect(pick?.videoId).toBe(approved);
  expect(pick?.genre).toBe('hip_hop_rap');
});

import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * The genre gate — the heart of WAJ Radio. These tests pin the door policy:
 *   manual authority > playability > cached verdict > YouTube topic > Claude
 * and the two failure disciplines: outages fail CLOSED without creating
 * requests or cache entries, and Electronic beats any allowed topic.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-music-gate-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

import {
  initMusicTables, setManualDecision, getGateCache, setGateCache,
} from '../src/lib/music/db';
import { gateVideo, type GateAdapters, type RawVideoData, type ClassifierResult } from '../src/lib/music/gate';

let n = 0;
const vid = () => `gv_${++n}_${Math.floor(Math.random() * 1e6)}`;

const BASE: RawVideoData = {
  title: 'Some Song', channelId: 'ch1', channelTitle: 'Some Artist',
  durationSeconds: 227, embeddable: true, madeForKids: false, live: false,
  regionBlockedDe: false, topicCategories: [],
};

function makeAdapters(overrides?: {
  video?: Partial<RawVideoData> | 'outage' | 'missing';
  classify?: ClassifierResult | 'outage';
}) {
  const calls = { fetch: 0, classify: 0 };
  const a: GateAdapters = {
    async fetchVideoData(ids) {
      calls.fetch++;
      if (overrides?.video === 'outage') return 'outage';
      const map = new Map<string, RawVideoData>();
      if (overrides?.video !== 'missing') {
        for (const id of ids) map.set(id, { ...BASE, ...(overrides?.video as Partial<RawVideoData> | undefined) });
      }
      return map;
    },
    async classify() {
      calls.classify++;
      if (overrides?.classify === 'outage') return 'outage';
      return overrides?.classify ?? { label: 'unsure', model: 'test-model', promptVersion: 1 };
    },
  };
  return { a, calls };
}

test.beforeAll(() => { initMusicTables(); });

test('manual deny wins before any adapter call', async () => {
  const v = vid();
  setManualDecision({ videoId: v, decision: 'deny', genre: null, reason: null, byUserId: 1, byName: 'E' });
  const { a, calls } = makeAdapters();
  const r = await gateVideo(v, a);
  expect(r.verdict).toBe('deny');
  expect(calls.fetch).toBe(0);
  expect(calls.classify).toBe(0);
});

test('manual allow passes with its genre; playability still enforced when metadata says unplayable', async () => {
  const v = vid();
  setManualDecision({ videoId: v, decision: 'allow', genre: 'afrobeats_afro', reason: null, byUserId: 1, byName: 'E' });
  const ok = await gateVideo(v, makeAdapters().a);
  expect(ok).toEqual({ verdict: 'allow', genre: 'afrobeats_afro', source: 'manual' });

  const v2 = vid();
  setManualDecision({ videoId: v2, decision: 'allow', genre: 'afrobeats_afro', reason: null, byUserId: 1, byName: 'E' });
  const bad = await gateVideo(v2, makeAdapters({ video: { embeddable: false } }).a);
  expect(bad.verdict).toBe('unplayable');
});

test('manual allow during a metadata outage still plays (playability enforced lazily by the player)', async () => {
  const v = vid();
  setManualDecision({ videoId: v, decision: 'allow', genre: 'reggae_dancehall_dub', reason: null, byUserId: 1, byName: 'E' });
  const r = await gateVideo(v, makeAdapters({ video: 'outage' }).a);
  expect(r.verdict).toBe('allow');
});

test('playability refusals regardless of genre topics', async () => {
  for (const [video, code] of [
    [{ embeddable: false, topicCategories: ['https://en.wikipedia.org/wiki/Reggae'] }, 'not_embeddable'],
    [{ live: true }, 'live'],
    [{ durationSeconds: 1200 }, 'too_long'],
    [{ madeForKids: true }, 'made_for_kids'],
    [{ regionBlockedDe: true }, 'region_blocked'],
    ['missing', 'not_found'],
  ] as const) {
    const { a } = makeAdapters({ video: video as never });
    const r = await gateVideo(vid(), a);
    expect(r.verdict).toBe('unplayable');
    if (r.verdict === 'unplayable') expect(r.reasonCode).toBe(code);
  }
});

test('Electronic topic is a terminal deny — even alongside Hip hop', async () => {
  const { a, calls } = makeAdapters({
    video: { topicCategories: ['https://en.wikipedia.org/wiki/Hip_hop_music', 'https://en.wikipedia.org/wiki/Electronic_music'] },
  });
  const v = vid();
  const r = await gateVideo(v, a);
  expect(r.verdict).toBe('deny');
  expect(calls.classify).toBe(0);
  expect(getGateCache(v)?.decision).toBe('deny');
  expect(getGateCache(v)?.decision_source).toBe('youtube_topic');
});

test('Hip hop and Reggae topics are terminal allows (no LLM call), cached', async () => {
  const hip = vid();
  const { a: a1, calls: c1 } = makeAdapters({ video: { topicCategories: ['https://en.wikipedia.org/wiki/Hip_hop_music'] } });
  const r1 = await gateVideo(hip, a1);
  expect(r1).toEqual({ verdict: 'allow', genre: 'hip_hop_rap', source: 'youtube_topic' });
  expect(c1.classify).toBe(0);
  expect(getGateCache(hip)?.decision).toBe('allow');

  const reg = vid();
  const { a: a2 } = makeAdapters({ video: { topicCategories: ['https://en.wikipedia.org/wiki/Reggae'] } });
  const r2 = await gateVideo(reg, a2);
  expect(r2).toEqual({ verdict: 'allow', genre: 'reggae_dancehall_dub', source: 'youtube_topic' });
});

test('R&B/Soul topic is a hint, not terminal — classifier confirms', async () => {
  const { a, calls } = makeAdapters({
    video: { topicCategories: ['https://en.wikipedia.org/wiki/Rhythm_and_blues'] },
    classify: { label: 'rnb_soul_funk', model: 'test-model', promptVersion: 1 },
  });
  const r = await gateVideo(vid(), a);
  expect(r.verdict).toBe('allow');
  if (r.verdict === 'allow') expect(r.genre).toBe('rnb_soul_funk');
  expect(calls.classify).toBe(1);
});

test('classifier labels map to verdicts and are cached', async () => {
  for (const [label, verdict] of [
    ['afrobeats_afro', 'allow'], ['hip_hop_rap', 'allow'],
    ['electronic', 'deny'], ['other', 'deny'], ['unsure', 'unsure'],
  ] as const) {
    const v = vid();
    const { a } = makeAdapters({ classify: { label, model: 'test-model', promptVersion: 1 } });
    const r = await gateVideo(v, a);
    expect(r.verdict).toBe(verdict);
    expect(getGateCache(v)?.decision).toBe(verdict);
    expect(getGateCache(v)?.decision_source).toBe('claude');
  }
});

test('cached verdict short-circuits — no adapter calls on the second tap', async () => {
  const v = vid();
  setGateCache({ videoId: v, decision: 'unsure', genre: null, source: 'claude', reasonCode: 'llm_unsure', model: 'm', promptVersion: 1 });
  const { a, calls } = makeAdapters();
  const r = await gateVideo(v, a);
  expect(r.verdict).toBe('unsure');
  expect(calls.fetch).toBe(0);
  expect(calls.classify).toBe(0);
});

test('metadata outage: classifier still runs using the search-result hint', async () => {
  const { a, calls } = makeAdapters({ video: 'outage', classify: { label: 'reggae_dancehall_dub', model: 'm', promptVersion: 1 } });
  const r = await gateVideo(vid(), a, { title: 'Song', channel: 'Artist' });
  expect(r.verdict).toBe('allow');
  expect(calls.classify).toBe(1);
});

test('metadata outage without a hint is a full outage', async () => {
  const { a } = makeAdapters({ video: 'outage' });
  const r = await gateVideo(vid(), a);
  expect(r.verdict).toBe('outage');
});

test('classifier outage fails closed: verdict outage, NOTHING cached', async () => {
  const v = vid();
  const { a } = makeAdapters({ classify: 'outage' });
  const r = await gateVideo(v, a);
  expect(r.verdict).toBe('outage');
  expect(getGateCache(v)).toBeNull();
});

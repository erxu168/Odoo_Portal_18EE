import { test, expect } from '@playwright/test';

/**
 * Adapter logic — the PURE parts only (network is stubbed or absent):
 * ISO-duration parsing, region blocks, Data-API item mapping, the circuit
 * breaker, unofficial-shape song extraction, and classifier label validation.
 */
import { parseIsoDuration, isRegionBlockedDe, mapApiItem, Breaker, fetchVideoData, resetBreakerForTests } from '../src/lib/music/youtube-data';
import { mapCatalogItem, extractSongs } from '../src/lib/music/catalog';
import { validateLabel, buildPrompt } from '../src/lib/music/classifier';

test('ISO 8601 durations parse; malformed → null', () => {
  expect(parseIsoDuration('PT3M47S')).toBe(227);
  expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
  expect(parseIsoDuration('PT45S')).toBe(45);
  expect(parseIsoDuration('PT2H')).toBe(7200);
  expect(parseIsoDuration('')).toBeNull();
  expect(parseIsoDuration(undefined)).toBeNull();
  expect(parseIsoDuration('3:47')).toBeNull();
  expect(parseIsoDuration('PT')).toBeNull();
});

test('DE region blocking: blocked list, allowed list without DE, or nothing', () => {
  expect(isRegionBlockedDe(undefined)).toBe(false);
  expect(isRegionBlockedDe({ blocked: ['DE', 'AT'] })).toBe(true);
  expect(isRegionBlockedDe({ blocked: ['US'] })).toBe(false);
  expect(isRegionBlockedDe({ allowed: ['US', 'GB'] })).toBe(true);
  expect(isRegionBlockedDe({ allowed: ['DE'] })).toBe(false);
});

test('Data API item maps to RawVideoData; embeddable defaults true, live detected', () => {
  const raw = mapApiItem({
    id: 'abc12345678',
    snippet: { title: 'Song', channelId: 'ch', channelTitle: 'Artist', liveBroadcastContent: 'live' },
    contentDetails: { duration: 'PT4M' },
    status: { madeForKids: false },
    topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Reggae'] },
  });
  expect(raw).toEqual({
    title: 'Song', channelId: 'ch', channelTitle: 'Artist', durationSeconds: 240,
    embeddable: true, madeForKids: false, live: true, regionBlockedDe: false,
    topicCategories: ['https://en.wikipedia.org/wiki/Reggae'],
  });
  expect(mapApiItem({ id: 'x' })).toBeNull(); // no title → not usable
});

test('breaker: opens after 2 consecutive failures, half-opens after the window', () => {
  const b = new Breaker(2, 60_000);
  const t0 = 1_000_000;
  expect(b.canTry(t0)).toBe(true);
  b.fail(t0); expect(b.canTry(t0)).toBe(true);
  b.fail(t0); expect(b.canTry(t0 + 1)).toBe(false);
  expect(b.canTry(t0 + 60_001)).toBe(true);
  b.ok(); expect(b.canTry(t0 + 60_002)).toBe(true);
});

test('fetchVideoData: no key → outage; HTTP failure twice → outage; success maps by id', async () => {
  resetBreakerForTests();
  const old = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  expect(await fetchVideoData(['a'])).toBe('outage');

  process.env.YOUTUBE_API_KEY = 'test-key';
  const failing = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
  expect(await fetchVideoData(['a'], failing)).toBe('outage');

  resetBreakerForTests();
  const okFetch = (async () => ({
    ok: true, status: 200,
    json: async () => ({ items: [{ id: 'vid1', snippet: { title: 'T', channelId: 'c', channelTitle: 'A' }, status: {}, contentDetails: { duration: 'PT3M' } }] }),
  })) as unknown as typeof fetch;
  const map = await fetchVideoData(['vid1'], okFetch);
  expect(map).not.toBe('outage');
  if (map !== 'outage') {
    expect(map.get('vid1')?.title).toBe('T');
    expect(map.get('vid1')?.durationSeconds).toBe(180);
  }
  if (old) process.env.YOUTUBE_API_KEY = old; else delete process.env.YOUTUBE_API_KEY;
});

test('catalog: maps song-like items across the shapes youtubei.js uses', () => {
  // Text-object title + artists array + duration object (music search shape)
  expect(mapCatalogItem({
    id: 'abc12345678', title: { text: 'Fever' },
    artists: [{ name: 'Vybz Kartel' }], duration: { seconds: 210 },
    thumbnails: [{ url: 'https://i.ytimg.com/x.jpg' }],
  })).toEqual({ videoId: 'abc12345678', title: 'Fever', artist: 'Vybz Kartel', durationSeconds: 210, thumbnail: 'https://i.ytimg.com/x.jpg' });

  // Plain-string title + author object (playlist item shape)
  expect(mapCatalogItem({ video_id: 'def12345678', title: 'Free Mind', author: { name: 'Tems' } }))
    .toEqual({ videoId: 'def12345678', title: 'Free Mind', artist: 'Tems', durationSeconds: null, thumbnail: null });

  expect(mapCatalogItem({ title: 'No id' })).toBeNull();
});

test('catalog: extractSongs finds items nested in shelves and dedupes', () => {
  const response = {
    contents: [
      { header: 'x' },
      { songs: { contents: [
        { id: 'aaa11111111', title: { text: 'One' }, artists: [{ name: 'A' }] },
        { id: 'aaa11111111', title: { text: 'One' }, artists: [{ name: 'A' }] },
      ] } },
      { items: [{ id: 'bbb22222222', title: 'Two', author: { name: 'B' } }] },
    ],
  };
  const songs = extractSongs(response);
  expect(songs.map((s) => s.videoId)).toEqual(['aaa11111111', 'bbb22222222']);
});

test('extractSongs: empty/garbage responses yield [] (caller treats as implausible)', () => {
  expect(extractSongs(null)).toEqual([]);
  expect(extractSongs({})).toEqual([]);
  expect(extractSongs({ contents: [{ header: 'only chrome' }] })).toEqual([]);
});

test('classifier: label validation is strict; prompt names all seven labels', () => {
  expect(validateLabel('afrobeats_afro')).toBe('afrobeats_afro');
  expect(validateLabel('unsure')).toBe('unsure');
  expect(validateLabel('reggaeton')).toBeNull();
  expect(validateLabel(42)).toBeNull();
  const p = buildPrompt({ title: 'X', channel: 'Y' });
  for (const l of ['hip_hop_rap', 'reggae_dancehall_dub', 'afrobeats_afro', 'rnb_soul_funk', 'electronic', 'other', 'unsure']) {
    expect(p).toContain(l);
  }
});

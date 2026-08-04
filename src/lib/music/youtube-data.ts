/**
 * WAJ Radio — YouTube Data API v3 adapter (videos.list ONLY — search.list has a
 * ~100-calls/day bucket and is never used; staff search goes through catalog.ts).
 *
 * Cost: 1 quota unit per call of up to 50 ids, from the 10k/day default pool.
 * Failure discipline: no key / HTTP error / malformed body → 'outage' (the gate
 * fails closed); one retry with backoff, then a 60s circuit breaker so a dead
 * API can't stall every tap.
 */
import type { RawVideoData } from '@/lib/music/gate';

/** "PT1H2M3S" → seconds, or null when malformed/absent. */
export function parseIsoDuration(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (parseInt(m[1] ?? '0', 10) * 3600) + (parseInt(m[2] ?? '0', 10) * 60) + parseInt(m[3] ?? '0', 10);
}

/** Germany is our venue: blocked when DE is in `blocked`, or an `allowed` list exists without DE. */
export function isRegionBlockedDe(r?: { allowed?: string[]; blocked?: string[] } | null): boolean {
  if (!r) return false;
  if (r.blocked?.includes('DE')) return true;
  if (r.allowed && !r.allowed.includes('DE')) return true;
  return false;
}

/** Tiny circuit breaker: after `threshold` consecutive failures, stay open for `openMs`. */
export class Breaker {
  private fails = 0;
  private openedAt = 0;
  constructor(private threshold = 2, private openMs = 60_000) {}
  canTry(now = Date.now()): boolean {
    if (this.fails < this.threshold) return true;
    return now - this.openedAt >= this.openMs;
  }
  ok(): void { this.fails = 0; this.openedAt = 0; }
  fail(now = Date.now()): void {
    this.fails += 1;
    if (this.fails >= this.threshold) this.openedAt = now;
  }
}

const breaker = new Breaker();
export function resetBreakerForTests(): void { breaker.ok(); }

interface ApiItem {
  id?: string;
  snippet?: { title?: string; channelId?: string; channelTitle?: string; liveBroadcastContent?: string };
  contentDetails?: {
    duration?: string;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
    contentRating?: { ytRating?: string };
  };
  status?: { embeddable?: boolean; madeForKids?: boolean };
  topicDetails?: { topicCategories?: string[] };
}

export function mapApiItem(item: ApiItem): RawVideoData | null {
  const id = item.id;
  const title = item.snippet?.title;
  if (!id || !title) return null;
  return {
    title,
    channelId: item.snippet?.channelId ?? '',
    channelTitle: item.snippet?.channelTitle ?? '',
    durationSeconds: parseIsoDuration(item.contentDetails?.duration),
    embeddable: item.status?.embeddable !== false,
    madeForKids: item.status?.madeForKids === true,
    live: (item.snippet?.liveBroadcastContent ?? 'none') !== 'none',
    regionBlockedDe: isRegionBlockedDe(item.contentDetails?.regionRestriction),
    ageRestricted: item.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted',
    topicCategories: item.topicDetails?.topicCategories ?? [],
  };
}

const API = 'https://www.googleapis.com/youtube/v3/videos';

export async function fetchVideoData(
  ids: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, RawVideoData> | 'outage'> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || ids.length === 0) return key ? new Map() : 'outage';
  if (!breaker.canTry()) return 'outage';

  const out = new Map<string, RawVideoData>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `${API}?part=snippet,contentDetails,status,topicDetails&id=${chunk.join(',')}&key=${key}`;
    let body: { items?: ApiItem[] } | null = null;
    for (let attempt = 0; attempt < 2 && !body; attempt++) {
      try {
        const res = await fetchImpl(url);
        if (res.ok) {
          body = (await res.json()) as { items?: ApiItem[] };
        } else if (attempt === 0 && res.status >= 500) {
          await new Promise((r) => setTimeout(r, 500));
        } else {
          break;
        }
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!body || !Array.isArray(body.items)) {
      breaker.fail();
      return 'outage';
    }
    for (const item of body.items) {
      const mapped = mapApiItem(item);
      if (mapped && item.id) out.set(item.id, mapped);
    }
  }
  breaker.ok();
  return out;
}

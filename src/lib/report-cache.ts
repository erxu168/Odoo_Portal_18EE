/**
 * Krawings Report Builder — In-Memory TTL Cache
 * 
 * Lightweight cache to avoid hammering Odoo with repeated queries.
 * Each cache entry has a TTL (time-to-live) in seconds.
 * Cache is per-process — resets on portal restart.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  computedAt: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Default TTLs per report screen (seconds) */
export const REPORT_TTL = {
  dashboard_today: 5 * 60,
  dashboard_period: 15 * 60,
  daily: 30 * 60,
  compare: 30 * 60,
  records: 60 * 60,
  pnl: 60 * 60,
  operations: 30 * 60,
  menu: 60 * 60,
  locations: 30 * 60,
  summary: 60 * 60,
} as const;

export function cacheKey(
  screen: string,
  locationId: number | string,
  period: string,
): string {
  return `report:${screen}:${locationId}:${period}`;
}

export function cacheGet<T>(key: string): { data: T; computedAt: string } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data, computedAt: entry.computedAt };
}

export function cacheSet<T>(key: string, data: T, ttlSeconds: number): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
    computedAt: new Date().toISOString(),
  });
}

export function cacheClear(): void {
  cache.clear();
}

export function cacheStats(): { entries: number; keys: string[] } {
  const now = Date.now();
  for (const [key, entry] of Array.from(cache.entries())) {
    if (now > entry.expiresAt) cache.delete(key);
  }
  return {
    entries: cache.size,
    keys: Array.from(cache.keys()),
  };
}

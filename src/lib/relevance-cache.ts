/**
 * The catalog's relevance cache.
 *
 * A shared product is only listed for a restaurant that actually uses it —
 * holds stock of it, buys it, builds with it, counts it — because otherwise
 * every screen would offer all thousand-plus shared products. Working that out
 * means several full-table reads, so the answer is cached for a few minutes.
 *
 * It lives here rather than beside the computation because Next.js route files
 * may only export route handlers, and creating a product has to be able to drop
 * the cache: a manager who adds something and then cannot find it in the list
 * concludes it was never created.
 */
const TTL_MS = 5 * 60 * 1000;

interface Entry { ids: number[]; at: number }

const cache = new Map<number, Entry>();

export function getCachedRelevance(companyId: number): number[] | null {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;
  return null;
}

export function setCachedRelevance(companyId: number, ids: number[]): void {
  cache.set(companyId, { ids, at: Date.now() });
}

/**
 * The stale set for a company whose refresh just failed. Serving it beats
 * failing open (every shared product) or closed (none), so an Odoo hiccup does
 * not empty or flood the screen.
 */
export function getStaleRelevance(companyId: number): number[] | null {
  return cache.get(companyId)?.ids ?? null;
}

/**
 * Evict OTHER companies' expired entries, so arbitrary company ids cannot grow
 * the map forever. This company's expired entry is left in place until a
 * successful refresh replaces it — that is what makes the stale fallback above
 * possible during an outage.
 */
export function evictOtherExpired(keep: number): void {
  cache.forEach((v, k) => {
    if (k !== keep && Date.now() - v.at >= TTL_MS) cache.delete(k);
  });
}

/** Drop everything — called after a product is created. */
export function invalidateRelevance(): void {
  cache.clear();
}

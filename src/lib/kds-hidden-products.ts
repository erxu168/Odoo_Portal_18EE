/**
 * Resolves the KDS "hidden categories" setting into the set of Odoo product IDs
 * the kitchen must not see.
 *
 * Why category -> products, resolved live against Odoo, instead of a per-product
 * flag stored locally: a drink added in Odoo next month is then hidden with no
 * manual "Sync products" step. The manager ticks a category once and it stays
 * correct.
 *
 * FAIL-SAFE: any failure returns an EMPTY set, i.e. "hide nothing". A network
 * blip must never make food invisible to the kitchen -- showing a drink again is
 * a cosmetic regression, losing a burger is a missed order.
 *
 * READ-ONLY against Odoo.
 */
import { getOdoo } from './odoo';

const TTL_MS = 60_000;
const CACHE_CAP = 16;

interface Entry { at: number; ids: Set<number> }

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Set<number>>>();

function keyOf(categIds: number[]): string {
  return [...categIds].sort((a, b) => a - b).join(',');
}

async function fetchFromOdoo(categIds: number[]): Promise<Set<number>> {
  const odoo = getOdoo();
  const rows = await odoo.searchRead(
    'product.product',
    [['pos_categ_ids', 'in', categIds]],
    ['id'],
    { limit: 2000 },
  );
  return new Set((rows as { id: number }[]).map(r => r.id));
}

/**
 * Product IDs belonging to any of the given pos.category IDs. Cached for TTL_MS
 * and single-flighted so every kitchen tablet polling the feed shares one Odoo
 * round-trip. Returns an empty set when nothing is hidden or when Odoo errors.
 */
export async function getHiddenProductIds(categIds: number[]): Promise<Set<number>> {
  const clean = (categIds ?? []).filter(n => Number.isInteger(n) && n > 0);
  if (clean.length === 0) return new Set();

  const key = keyOf(clean);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ids;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const p = fetchFromOdoo(clean)
    .then(ids => {
      cache.set(key, { at: Date.now(), ids });
      while (cache.size > CACHE_CAP) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return ids;
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[KDS] hidden-category lookup failed, showing all items:', msg);
      // Serve the last known good set if we have one, else hide nothing.
      return cache.get(key)?.ids ?? new Set<number>();
    })
    .finally(() => { inFlight.delete(key); });

  inFlight.set(key, p);
  return p;
}

/**
 * Resolve till (Odoo) product names for cook profiles.
 *
 * A cook profile stores only the Odoo product id. The manager Setup screen shows
 * the REAL dish name, looked up live, so renaming a dish on the till shows
 * through here and a manager can always tell what a profile is mapped to.
 * Read-only — the Cooking Timer never writes to Odoo.
 *
 * Cached briefly: Setup reloads the whole list after every mutation, so without
 * a cache a burst of edits would hammer Odoo with identical reads.
 */
import { getOdoo } from './odoo';
import { listProfilesAdmin } from './cooktimer-db';
import type { CookProfileAdmin } from '@/types/cooktimer';

const TTL_MS = 30_000;
let cache: { at: number; names: Map<number, string> } | null = null;

/**
 * Names for the given product ids: id -> name. An id missing from the result
 * means the product no longer exists on the till (the UI shows that state).
 * Never throws — on an Odoo failure it returns what it has (possibly nothing),
 * so Setup still renders rather than failing on a cosmetic lookup.
 */
export async function resolveProductNames(ids: number[]): Promise<Map<number, string>> {
  const wanted = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
  if (wanted.length === 0) return new Map();

  const fresh = cache && Date.now() - cache.at < TTL_MS ? cache.names : null;
  if (fresh && wanted.every(id => fresh.has(id))) return fresh;

  try {
    const rows = await getOdoo().searchRead(
      'product.product',
      [['id', 'in', wanted]],
      ['id', 'name'],
      { limit: Math.max(wanted.length, 1) },
    );
    const names = new Map<number, string>(fresh ?? []);
    for (const r of rows as { id: number; name: string }[]) {
      if (r && typeof r.name === 'string') names.set(r.id, r.name);
    }
    cache = { at: Date.now(), names };
    return names;
  } catch (err) {
    console.error('[cooktimer] product name lookup failed:', err instanceof Error ? err.message : err);
    return fresh ?? new Map();
  }
}

/**
 * The Setup screen's canonical profile list, with each profile's live till name
 * attached. Every setup route returns this so the client always renders real
 * dish names rather than a bare product id.
 */
export async function listProfilesWithNames(): Promise<CookProfileAdmin[]> {
  const profiles = listProfilesAdmin();
  const ids = profiles
    .map(p => p.odooProductId)
    .filter((id): id is number => typeof id === 'number');
  const names = await resolveProductNames(ids);
  return profiles.map(p => ({
    ...p,
    productName: p.odooProductId != null ? names.get(p.odooProductId) ?? null : null,
  }));
}

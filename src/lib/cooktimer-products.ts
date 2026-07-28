/**
 * Resolve till (Odoo) product names for cook profiles.
 *
 * A cook profile stores only the Odoo product id. The manager Setup screen shows
 * the REAL dish name, looked up live, so renaming a dish on the till shows
 * through here and a manager can always tell what a profile is mapped to.
 * Read-only — the Cooking Timer never writes to Odoo.
 *
 * Cached PER ID (each with its own timestamp) because Setup reloads the whole
 * list after every mutation: without it a burst of edits hammers Odoo, and with
 * a single shared timestamp a partial refresh would keep untouched names "fresh"
 * for ever. Misses are cached too, so one deleted product doesn't force a fresh
 * Odoo round-trip on every save.
 */
import { getOdoo } from './odoo';
import { listProfilesAdmin } from './cooktimer-db';
import type { CookProfileAdmin } from '@/types/cooktimer';

const TTL_MS = 30_000;

/** name === null means "asked Odoo, product does not exist". */
interface Entry { at: number; name: string | null }
const cache = new Map<number, Entry>();

export interface NameLookup {
  names: Map<number, string | null>;
  /** True when Odoo could not be reached, so a missing name is UNKNOWN rather
   *  than proof the product was deleted. */
  unavailable: boolean;
}

/**
 * Names for the given product ids. Never throws: on an Odoo failure it returns
 * whatever is cached and flags `unavailable`, so Setup still renders and never
 * reports an outage as "this dish was deleted".
 */
export async function resolveProductNames(ids: number[]): Promise<NameLookup> {
  const wanted = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
  const names = new Map<number, string | null>();
  if (wanted.length === 0) return { names, unavailable: false };

  const now = Date.now();
  const stale: number[] = [];
  for (const id of wanted) {
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) names.set(id, hit.name);
    else stale.push(id);
  }
  if (stale.length === 0) return { names, unavailable: false };

  try {
    const rows = await getOdoo().searchRead(
      'product.product', [['id', 'in', stale]], ['id', 'name'], { limit: stale.length },
    );
    const found = new Map<number, string>();
    for (const r of rows as { id: number; name: string }[]) {
      if (r && typeof r.name === 'string') found.set(r.id, r.name);
    }
    const at = Date.now();
    for (const id of stale) {
      const name = found.get(id) ?? null;   // absent from Odoo => genuinely gone
      cache.set(id, { at, name });
      names.set(id, name);
    }
    return { names, unavailable: false };
  } catch (err) {
    console.error('[cooktimer] product name lookup failed:', err instanceof Error ? err.message : err);
    // Serve last-known-good for anything we have, and say the lookup failed.
    for (const id of stale) {
      const hit = cache.get(id);
      if (hit) names.set(id, hit.name);
    }
    return { names, unavailable: true };
  }
}

/**
 * The Setup screen's canonical profile list, with each profile's live till name
 * attached. `productName` is null when the dish is gone from the till OR the
 * lookup was unavailable — `productNameUnavailable` tells the two apart so the
 * UI never claims a dish was deleted during an Odoo outage.
 */
export async function listProfilesWithNames(): Promise<{
  profiles: CookProfileAdmin[];
  productNameUnavailable: boolean;
}> {
  const profiles = listProfilesAdmin();
  const ids = profiles
    .map(p => p.odooProductId)
    .filter((id): id is number => typeof id === 'number');
  const { names, unavailable } = await resolveProductNames(ids);
  return {
    profiles: profiles.map(p => ({
      ...p,
      productName: p.odooProductId != null ? names.get(p.odooProductId) ?? null : null,
    })),
    productNameUnavailable: unavailable,
  };
}

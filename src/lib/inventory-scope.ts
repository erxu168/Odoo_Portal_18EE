/**
 * What a counting session is ALLOWED to contain.
 *
 * A modern session freezes its exact lines, so the answer is simply "the frozen
 * ones". A legacy session has no snapshot and the answer comes from its
 * template — and there the template can name its products explicitly OR name
 * categories and let the products follow.
 *
 * That last case was a hole: POST /api/inventory/counts only rejected a product
 * when the template's explicit list was non-empty, so a CATEGORY-ONLY list
 * accepted any product id in the database — and approval then wrote stock for
 * it. The categories live only in SQLite; nothing on the server had ever
 * resolved them to products (the count screen does it in the browser). This
 * does that resolution, once, server-side.
 */

import { getTemplate, getSessionItems } from './inventory-db';
import type { CountingSession } from '@/types/inventory';
import { getOdoo } from './odoo';

/** Resolved products in a set of Odoo product categories. */
const CACHE_MS = 60_000;
const categoryCache = new Map<string, { ids: Set<number>; at: number }>();

async function productsInCategories(
  categoryIds: number[],
  /**
   * Only products a person can actually SEE and therefore answer.
   *
   * Two different questions get asked of this set and they need different
   * answers. "May this line be saved?" must include ARCHIVED products — a
   * product archived mid-count still has to accept the number already being
   * entered against it. "Must this line be answered before submitting?" must
   * NOT, because the counting screen lists active products only, so demanding
   * an archived one makes the count unsubmittable with no way to fix it.
   *
   * The old comment here claimed this matched the count screen. It did not:
   * the screen lists active products, this passed active_test: false.
   */
  activeOnly = false,
): Promise<Set<number> | null> {
  const key = `${activeOnly ? 'a' : 'all'}:${categoryIds.slice().sort((a, b) => a - b).join(',')}`;
  const hit = categoryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;
  try {
    const odoo = await getOdoo();
    const rows = await odoo.searchRead(
      'product.product',
      activeOnly
        ? [['categ_id', 'in', categoryIds], ['active', '=', true]]
        : [['categ_id', 'in', categoryIds]],
      ['id'],
      { limit: 5000, ...(activeOnly ? {} : { context: { active_test: false } }) },
    ) as { id: number }[];
    const ids = new Set(rows.map((r) => r.id));
    categoryCache.set(key, { ids, at: Date.now() });
    return ids;
  } catch {
    // Odoo unreachable. The caller decides whether that is fatal — it is at
    // approval (which writes stock anyway) and is not while someone is counting.
    return null;
  }
}

export type ScopeResult =
  | { kind: 'known'; ids: Set<number> }
  /** The list is defined by categories and Odoo could not be asked right now. */
  | { kind: 'unknown' };

/**
 * Every product id this session may legitimately hold a count for.
 * Order matters: the frozen snapshot wins over the template, because a template
 * edited after the count started must not change what the count is about.
 */
export async function allowedProductIds(
  session: CountingSession,
  /** true when the caller is deciding what MUST be answered, not what may be saved. */
  opts: { activeOnly?: boolean } = {},
): Promise<ScopeResult> {
  const snapshot = getSessionItems(session.id);
  if (snapshot.length > 0) {
    return { kind: 'known', ids: new Set(snapshot.map((it) => it.odoo_product_id)) };
  }
  const tmpl = getTemplate(session.template_id);
  const explicit: number[] = Array.isArray(tmpl?.product_ids) ? (tmpl!.product_ids as number[]) : [];
  if (explicit.length > 0) return { kind: 'known', ids: new Set(explicit) };

  const cats: number[] = Array.isArray(tmpl?.category_ids) ? (tmpl!.category_ids as number[]) : [];
  if (cats.length === 0) {
    // Neither products nor categories: an empty list allows nothing.
    return { kind: 'known', ids: new Set<number>() };
  }
  const ids = await productsInCategories(cats.filter((c) => Number.isInteger(c) && c > 0), opts.activeOnly);
  return ids ? { kind: 'known', ids } : { kind: 'unknown' };
}

/** Test seam — the cache is process-wide and would otherwise leak between tests. */
export function __clearCategoryScopeCache() {
  categoryCache.clear();
}

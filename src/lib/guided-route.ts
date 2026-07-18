/**
 * Pure helpers for the guided counting route. No I/O — safe to unit test.
 *
 * Turns a session's products + their location placements into an ordered list
 * of "stops" (one per count location, in walking order, products in shelf
 * order), plus a final "Everything else" stop for products not yet placed.
 *
 * Scoping note (Phase 2): a product placed in several locations is counted ONCE
 * at its PRIMARY location (the earliest stop it belongs to). Counting the same
 * product separately per location and summing is a future enhancement.
 */

import { buildLocationTree } from './location-tree';

export interface RouteLocationMeta {
  id: number;
  parent_id: number | null;
  name: string;
  kind: string;
  photo: string | null;
  description: string | null;
  sort_order: number;
}

export type StopStatus = 'pending' | 'counted' | 'skipped';

export interface RouteStop {
  location: RouteLocationMeta | null; // null = "Everything else" bucket (id 0)
  bucket_id: number;                  // count_location_id, or 0 for "Everything else"
  product_ids: number[];              // in shelf order
  status: StopStatus;
  skip_reason: string | null;
}

export const EVERYTHING_ELSE = 0;

export function buildGuidedRoute(params: {
  productIds: number[];
  placements: { odoo_product_id: number; count_location_id: number; shelf_sort: number }[];
  locations: RouteLocationMeta[];
  statuses: { count_location_id: number; status: string; skip_reason: string | null }[];
}): { guided: boolean; stops: RouteStop[] } {
  const { productIds, placements, locations, statuses } = params;

  const locById = new Map<number, RouteLocationMeta>();
  locations.forEach((l) => locById.set(l.id, l));

  // Walking order = pre-order DFS of the location tree (sort_order is
  // sibling-relative, so a flat sort would interleave shelves across areas).
  const walkOrder = new Map<number, number>();
  let walkIdx = 0;
  const assignWalk = (nodes: { id: number; children: { id: number; children: unknown[] }[] }[]) => {
    for (const n of nodes) {
      walkOrder.set(n.id, walkIdx++);
      assignWalk(n.children as { id: number; children: { id: number; children: unknown[] }[] }[]);
    }
  };
  assignWalk(buildLocationTree(locations) as unknown as { id: number; children: { id: number; children: unknown[] }[] }[]);

  const statusByLoc = new Map<number, { status: StopStatus; skip_reason: string | null }>();
  statuses.forEach((s) => statusByLoc.set(s.count_location_id, {
    status: (['counted', 'skipped', 'pending'].includes(s.status) ? s.status : 'pending') as StopStatus,
    skip_reason: s.skip_reason ?? null,
  }));

  // Placements for a product, only those pointing at a known location.
  const placementsByProduct = new Map<number, { count_location_id: number; shelf_sort: number }[]>();
  placements.forEach((p) => {
    if (!locById.has(p.count_location_id)) return;
    const arr = placementsByProduct.get(p.odoo_product_id) || [];
    arr.push({ count_location_id: p.count_location_id, shelf_sort: p.shelf_sort });
    placementsByProduct.set(p.odoo_product_id, arr);
  });

  // Primary placement = the one that comes EARLIEST in the walking order
  // (DFS index), so a product in several nested locations lands at the first
  // stop you actually reach.
  const primaryOf = (pid: number): { count_location_id: number; shelf_sort: number } | null => {
    const arr = placementsByProduct.get(pid);
    if (!arr || arr.length === 0) return null;
    return arr.slice().sort((a, b) => {
      const wa = walkOrder.get(a.count_location_id) ?? locById.get(a.count_location_id)!.sort_order;
      const wb = walkOrder.get(b.count_location_id) ?? locById.get(b.count_location_id)!.sort_order;
      return wa - wb || a.count_location_id - b.count_location_id;
    })[0];
  };

  const groups = new Map<number, { pid: number; shelf_sort: number }[]>();
  const unplaced: number[] = [];
  productIds.forEach((pid) => {
    const prim = primaryOf(pid);
    if (!prim) { unplaced.push(pid); return; }
    const g = groups.get(prim.count_location_id) || [];
    g.push({ pid, shelf_sort: prim.shelf_sort });
    groups.set(prim.count_location_id, g);
  });

  const stops: RouteStop[] = [];
  Array.from(groups.keys())
    .map((id) => locById.get(id)!)
    .sort((a, b) => (walkOrder.get(a.id) ?? a.sort_order) - (walkOrder.get(b.id) ?? b.sort_order) || a.id - b.id)
    .forEach((loc) => {
      const items = groups.get(loc.id)!.slice().sort((a, b) => a.shelf_sort - b.shelf_sort || a.pid - b.pid);
      const st = statusByLoc.get(loc.id);
      stops.push({
        location: loc,
        bucket_id: loc.id,
        product_ids: items.map((i) => i.pid),
        status: st?.status ?? 'pending',
        skip_reason: st?.skip_reason ?? null,
      });
    });

  if (unplaced.length > 0) {
    const st = statusByLoc.get(EVERYTHING_ELSE);
    stops.push({
      location: null,
      bucket_id: EVERYTHING_ELSE,
      product_ids: unplaced,
      status: st?.status ?? 'pending',
      skip_reason: st?.skip_reason ?? null,
    });
  }

  const guided = stops.some((s) => s.location !== null);
  return { guided, stops };
}

/** Every stop with products must be counted or skipped for a guided submit to pass. */
export function missedStops(stops: RouteStop[]): RouteStop[] {
  return stops.filter((s) => s.product_ids.length > 0 && s.status === 'pending');
}

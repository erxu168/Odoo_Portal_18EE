/**
 * Resolve a counting session into its guided walking route.
 * Shared by GET /api/inventory/sessions/[id]/route and the submit gate.
 *
 * Only templates with explicit product_ids get a guided route; category-based
 * templates (products resolved via Odoo) fall back to flat counting (guided:false).
 */
import {
  getSession, getTemplate, getPlacementsForProducts,
  getCountLocationsByIds, listCountLocations, getSessionLocationStatuses,
  getSessionItems, getSessionLocations,
} from './inventory-db';
import { buildGuidedRoute, type RouteStop } from './guided-route';

export function resolveSessionRoute(sessionId: number): { guided: boolean; stops: RouteStop[] } {
  const session = getSession(sessionId);
  if (!session) return { guided: false, stops: [] };

  // MODERN sessions: resolve from the FROZEN snapshot — the items (one per
  // product+spot pair) and the frozen spot names/walk order. Template or
  // Locations edits after creation can never re-route an open count.
  const items = getSessionItems(sessionId);
  if (items.length > 0) {
    const frozen = getSessionLocations(sessionId);
    const liveById = new Map(getCountLocationsByIds(frozen.map((f) => f.count_location_id)).map((l) => [l.id, l]));
    const locations = frozen.map((f) => {
      const live = liveById.get(f.count_location_id);
      return {
        id: f.count_location_id,
        parent_id: null,                       // frozen walk is already linearized
        name: f.name,                          // name AT FREEZE TIME
        kind: f.kind ?? (live?.kind ?? 'area'),
        photo: live?.photo ?? null,            // photo is cosmetic — live is fine
        description: live?.description ?? null,
        sort_order: f.walk_order,
      };
    });
    const placements = items.map((it) => ({
      odoo_product_id: it.odoo_product_id,
      count_location_id: it.count_location_id,
      shelf_sort: it.shelf_sort,
    }));
    const productIds = Array.from(new Set(items.map((it) => it.odoo_product_id)));
    const statuses = getSessionLocationStatuses(sessionId);
    return buildGuidedRoute({ productIds, placements, locations, statuses });
  }

  // LEGACY sessions (no snapshot): live template + global placements, as before.
  const template = getTemplate(session.template_id);
  const productIds = template?.product_ids ?? [];
  if (!Array.isArray(productIds) || productIds.length === 0) return { guided: false, stops: [] };

  const placements = getPlacementsForProducts(productIds);
  if (placements.length === 0) {
    return buildGuidedRoute({ productIds, placements, locations: [], statuses: [] });
  }
  // Resolve the company from the referenced locations, then load that company's
  // FULL location tree so the walking order (DFS) is correct across areas/shelves.
  const refIds = Array.from(new Set(placements.map((p) => p.count_location_id)));
  const refs = getCountLocationsByIds(refIds);
  if (refs.length === 0) {
    return buildGuidedRoute({ productIds, placements, locations: [], statuses: [] });
  }
  // A session belongs to ONE restaurant. Prefer the template's authoritative
  // company_id (set on create); only fall back to the placement-majority
  // heuristic for legacy lists that pre-date the company_id column. Scoping the
  // location tree + placements to this company means a product shared across
  // restaurants can never pull in another company's locations.
  let companyId = session.company_id ?? null;
  if (companyId == null) {
    const byCompany = new Map<number, number>();
    refs.forEach((r) => byCompany.set(r.company_id, (byCompany.get(r.company_id) || 0) + 1));
    companyId = Array.from(byCompany.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  }

  const locations = listCountLocations(companyId);
  const compLocIds = new Set(locations.map((l) => l.id));
  const scopedPlacements = placements.filter((p) => compLocIds.has(p.count_location_id));
  const statuses = getSessionLocationStatuses(sessionId);

  return buildGuidedRoute({ productIds, placements: scopedPlacements, locations, statuses });
}

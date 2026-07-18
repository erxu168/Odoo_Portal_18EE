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
} from './inventory-db';
import { buildGuidedRoute, type RouteStop } from './guided-route';

export function resolveSessionRoute(sessionId: number): { guided: boolean; stops: RouteStop[] } {
  const session = getSession(sessionId);
  if (!session) return { guided: false, stops: [] };

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
  // A session belongs to ONE restaurant. Pick the company deterministically
  // (the one owning the most referenced locations; tie -> lowest id) and scope
  // both the location tree and placements to it, so a product shared across
  // companies can't pull in another company's locations.
  // KNOWN LIMITATION: this is a heuristic, not derived from the session's Odoo
  // location. It is correct whenever a product is only placed within one
  // company (the normal case). If the SAME Odoo product is placed in two
  // different companies' locations, the majority company wins. A fully
  // authoritative fix would read the session's stock.location.company_id from
  // Odoo — deferred (adds an Odoo call to a hot path for an edge case that does
  // not occur in the current 2-3 restaurant setup).
  const byCompany = new Map<number, number>();
  refs.forEach((r) => byCompany.set(r.company_id, (byCompany.get(r.company_id) || 0) + 1));
  const companyId = Array.from(byCompany.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];

  const locations = listCountLocations(companyId);
  const compLocIds = new Set(locations.map((l) => l.id));
  const scopedPlacements = placements.filter((p) => compLocIds.has(p.count_location_id));
  const statuses = getSessionLocationStatuses(sessionId);

  return buildGuidedRoute({ productIds, placements: scopedPlacements, locations, statuses });
}

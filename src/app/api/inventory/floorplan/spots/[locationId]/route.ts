export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplan/spots/[locationId] — the bottom-sheet payload (view):
 * the spot, its full path, its photo, where it sits on the plan, and the
 * products stored there (name + category + thumbnail flag).
 */
import { NextResponse } from 'next/server';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import { initFloorplanTables, getPrimaryAnchorForLocation } from '@/lib/inventory-floorplan/db';
import { getCountLocation, listCountLocations, listProductImageIds, getPlacements } from '@/lib/inventory-db';
import { locationPath } from '@/lib/location-tree';
import { getDb } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

export async function GET(_request: Request, { params }: { params: { locationId: string } }) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.view);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  if (!/^\d+$/.test(params.locationId)) return NextResponse.json({ error: 'Invalid spot' }, { status: 400 });
  const loc = getCountLocation(parseInt(params.locationId, 10));
  if (!loc || !canAccessCompany(authz.user, loc.company_id)) {
    return NextResponse.json({ error: 'Spot not found' }, { status: 404 });
  }

  const all = listCountLocations(loc.company_id) as Array<{ id: number; name: string; parent_id: number | null; sort_order: number; kind: string }>;
  const placements = getDb().prepare(
    'SELECT odoo_product_id FROM product_locations WHERE count_location_id = ? ORDER BY shelf_sort, odoo_product_id',
  ).all(loc.id) as Array<{ odoo_product_id: number }>;

  let products: Array<{ id: number; name: string; category: string | null; hasImage: boolean }> | null = [];
  if (placements.length > 0) {
    try {
      const odoo = getOdoo();
      const rows = (await odoo.searchRead(
        'product.product',
        [['id', 'in', placements.map(p => p.odoo_product_id)]],
        ['display_name', 'categ_id'],
      )) as Array<{ id: number; display_name: string; categ_id: [number, string] | false }>;
      const withImages = new Set(listProductImageIds());
      const order = new Map(placements.map((p, i) => [p.odoo_product_id, i]));
      products = rows
        .map(r => ({
          id: r.id,
          name: r.display_name,
          category: Array.isArray(r.categ_id) ? r.categ_id[1] : null,
          hasImage: withImages.has(r.id),
        }))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } catch {
      products = null; // "products unavailable" ≠ "none stored here"
    }
  }

  // What is INSIDE this place (a countertop fridge holds drawers D1..D8).
  // Nested items don't each need a marker — you find the fridge on the plan,
  // then drill into it here.
  const children = all
    .filter(l => l.parent_id === loc.id)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .map(c => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      productCount: getPlacements(c.id).length,
    }));

  const anchor = getPrimaryAnchorForLocation(loc.id);
  return NextResponse.json({
    children,
    location: { id: loc.id, name: loc.name, kind: loc.kind, photo: loc.photo ?? null, company_id: loc.company_id },
    path: locationPath(loc.id, all).join(' · '),
    anchor: anchor ? { floorId: anchor.floor_id, cx: anchor.cx, cy: anchor.cy } : null,
    products,
    productsUnavailable: products === null,
  });
}

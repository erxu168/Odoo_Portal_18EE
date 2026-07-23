export const dynamic = 'force-dynamic';
/**
 * /api/inventory/product-locations
 * GET ?count_location_id= — products placed at a spot (with shelf order)
 * GET ?product_id=        — which spots a product lives in
 * GET ?company_id=        — every product→spot placement of one restaurant
 * PUT                     — set a product's home spots, PRODUCT-FIRST only:
 *                          { odoo_product_id, company_id, count_location_ids }.
 *                          (The old destructive spot-first replace is retired.)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import {
  initInventoryTables, getPlacements,
  getLocationsForProduct, getCountLocation, listPlacementsForCompany, setProductSpots,
  listCountLocations,
} from '@/lib/inventory-db';
import { canAccessCompany } from '@/lib/inventory-access';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const locId = parseInt(searchParams.get('count_location_id') || '0', 10);
  const prodId = parseInt(searchParams.get('product_id') || '0', 10);

  if (locId) {
    // Only expose a spot's placements to a caller allowed that location's company.
    const loc = getCountLocation(locId);
    if (!loc || !canAccessCompany(user, loc.company_id))
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    return NextResponse.json({ placements: getPlacements(locId) });
  }
  if (prodId) {
    // Filter to locations in the caller's companies (no cross-company leak).
    const ids = getLocationsForProduct(prodId).filter((id) => {
      const l = getCountLocation(id);
      return l && canAccessCompany(user, l.company_id);
    });
    return NextResponse.json({ location_ids: ids });
  }

  // Company-wide map: every product→spot placement of ONE restaurant, so a
  // screen can render each product's home-spot chips with a single request.
  const companyId = parseInt(searchParams.get('company_id') || '0', 10);
  if (companyId) {
    if (!canAccessCompany(user, companyId))
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ placements: listPlacementsForCompany(companyId) });
  }
  return NextResponse.json({ error: 'count_location_id, product_id or company_id required' }, { status: 400 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const body = await request.json();
  const isProductFirst = body.odoo_product_id != null && Array.isArray(body.count_location_ids);

  // PRODUCT-FIRST (the only variant): set a product's home spots within one restaurant.
  // Body: { odoo_product_id, company_id, count_location_ids: number[] }
  // Reachable from three doors (list builder, Product Settings, Locations), so
  // any of their capabilities authorizes it.
  if (isProductFirst) {
    const overrides = getPermissionOverrides();
    const mayEdit = ['inventory.template.manage', 'inventory.productsettings.manage', 'inventory.location.manage']
      .some((k) => roleCan(user.role, k, overrides));
    if (!mayEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const productId = Number(body.odoo_product_id);
    const companyId = Number(body.company_id);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(companyId) || companyId <= 0)
      return NextResponse.json({ error: 'odoo_product_id and company_id are required' }, { status: 400 });
    if (!canAccessCompany(user, companyId))
      return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
    // Every requested spot must be one of THIS restaurant's active spots — a
    // foreign/stale id rejects the WHOLE request (never a silent partial write).
    // [] is a valid "no home spots in this restaurant".
    const valid = new Set(listCountLocations(companyId).map((l) => l.id));
    const spotIds: number[] = Array.from(new Set<number>(body.count_location_ids.map(Number)));
    if (spotIds.some((id: number) => !Number.isInteger(id) || id <= 0 || !valid.has(id)))
      return NextResponse.json({ error: 'One of those spots does not belong to this restaurant' }, { status: 400 });
    try {
      setProductSpots(productId, spotIds, companyId);
    } catch {
      // In-transaction revalidation failed (spot deleted mid-flight) — nothing applied.
      return NextResponse.json({ error: 'A spot was just removed — reload and try again' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Home spots saved' });
  }

  // The old spot-first PUT (replace a whole shelf's product list) is retired —
  // it did a destructive DELETE-then-reinsert that could silently drop a
  // placement another door had just saved. Home spots are now set product-first
  // only (SpotSheet), which touches just the one product. No caller remains.
  return NextResponse.json({ error: 'Set home spots product-first: { odoo_product_id, company_id, count_location_ids }.' }, { status: 400 });
}

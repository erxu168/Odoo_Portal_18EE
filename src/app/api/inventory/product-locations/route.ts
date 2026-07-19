export const dynamic = 'force-dynamic';
/**
 * /api/inventory/product-locations
 * GET ?count_location_id= — products placed at a spot (with shelf order)
 * GET ?product_id=        — which spots a product lives in
 * PUT                     — replace a spot's full placement set (manager/admin)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import {
  initInventoryTables, setProductPlacements, getPlacements,
  getLocationsForProduct, getCountLocation,
} from '@/lib/inventory-db';
import { canAccessCompany } from '@/lib/inventory-access';

const KEY = 'inventory.location.manage';

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
  return NextResponse.json({ error: 'count_location_id or product_id required' }, { status: 400 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  initInventoryTables();

  const body = await request.json();
  const { count_location_id, items } = body;
  if (!count_location_id || !Array.isArray(items))
    return NextResponse.json({ error: 'count_location_id and items[] are required' }, { status: 400 });

  // Company scope: the target location must belong to one of the caller's companies.
  const loc = getCountLocation(count_location_id);
  if (!loc || !canAccessCompany(user, loc.company_id))
    return NextResponse.json({ error: 'Location not found' }, { status: 404 });

  setProductPlacements(count_location_id, items.map((it: { odoo_product_id: number; shelf_sort?: number }, i: number) => ({
    odoo_product_id: it.odoo_product_id,
    shelf_sort: it.shelf_sort ?? (i + 1) * 10,
  })));
  return NextResponse.json({ message: 'Placements saved' });
}

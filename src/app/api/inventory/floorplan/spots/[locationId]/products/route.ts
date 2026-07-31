export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplan/spots/[locationId]/products
 * POST — assign/unassign products AT THIS SPOT: { add: number[], remove: number[] }
 *
 * The spot-first door onto the SAME placement records the product page edits:
 * standing at a shelf (or scanning its QR), tick what is on it. Deliberately
 * NON-destructive — the retired spot-first PUT replaced a whole shelf's list
 * and could drop a placement another screen had just saved. Here each affected
 * product keeps its OTHER home spots; only this spot is added or removed, and
 * the write goes through setProductsSpotsBulk so the overlap invariant (never
 * home a product at both a place and something inside it) is enforced for
 * every writer in one transaction.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import {
  initInventoryTables, getCountLocation, getLocationsForProduct, setProductsSpotsBulk,
} from '@/lib/inventory-db';
import { canAccessCompany } from '@/lib/inventory-access';

const MAX_PER_CALL = 200;

export async function POST(request: Request, { params }: { params: { locationId: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  // Same three doors that may set home spots product-first.
  const overrides = getPermissionOverrides();
  const mayEdit = ['inventory.template.manage', 'inventory.productsettings.manage', 'inventory.location.manage']
    .some(k => roleCan(user.role, k, overrides));
  if (!mayEdit) return NextResponse.json({ error: 'You do not have permission to assign products' }, { status: 403 });

  if (!/^\d+$/.test(params.locationId)) return NextResponse.json({ error: 'Invalid spot' }, { status: 400 });
  const loc = getCountLocation(parseInt(params.locationId, 10));
  if (!loc || !canAccessCompany(user, loc.company_id)) {
    return NextResponse.json({ error: 'Spot not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const add: number[] = Array.isArray(body?.add) ? Array.from(new Set(body.add.map(Number))) : [];
  const remove: number[] = Array.isArray(body?.remove) ? Array.from(new Set(body.remove.map(Number))) : [];
  if (add.length + remove.length === 0) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  }
  if (add.length + remove.length > MAX_PER_CALL) {
    return NextResponse.json({ error: 'Too many products at once — save in smaller batches' }, { status: 400 });
  }
  if ([...add, ...remove].some(id => !Number.isInteger(id) || id <= 0)) {
    return NextResponse.json({ error: 'Invalid product' }, { status: 400 });
  }
  const overlap = add.filter(id => remove.includes(id));
  if (overlap.length) return NextResponse.json({ error: 'A product is both added and removed' }, { status: 400 });

  // Each product keeps every other home spot it has in THIS restaurant; only
  // this spot moves in or out. Other companies' placements are never touched.
  const sameCompany = (id: number) => {
    const l = getCountLocation(id);
    return !!l && l.company_id === loc.company_id;
  };
  const entries = [
    ...add.map(productId => {
      const current = getLocationsForProduct(productId).filter(sameCompany);
      return { product_id: productId, spot_ids: Array.from(new Set([...current, loc.id])) };
    }),
    ...remove.map(productId => {
      const current = getLocationsForProduct(productId).filter(sameCompany);
      return { product_id: productId, spot_ids: current.filter(id => id !== loc.id) };
    }),
  ];

  try {
    setProductsSpotsBulk(loc.company_id, entries);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('OVERLAPPING_PLACEMENT')) {
      return NextResponse.json({
        error: 'One of those products already lives in a place that contains this one (or inside it) — that would count it twice.',
      }, { status: 400 });
    }
    return NextResponse.json({ error: 'A spot changed while saving — reload and try again' }, { status: 409 });
  }

  return NextResponse.json({ message: 'Saved', added: add.length, removed: remove.length });
}

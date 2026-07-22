/**
 * /api/purchase/guides
 * GET    - get guide for a supplier+location
 * POST   - add item to guide (manager+)
 * DELETE - remove item OR delete entire guide (manager+)
 * PATCH  - update item price (manager+)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getGuideWithItems, getGuide, createGuide, addGuideItem, removeGuideItem, updateGuideItemPrice, reorderGuideItems } from '@/lib/purchase-db';
import { canAccessPurchaseLocation, isUnrestrictedAdmin } from '@/lib/purchase-access';
import { getDb } from '@/lib/db';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const supplierId = parseInt(searchParams.get('supplier_id') || '0');
  const locationId = parseInt(searchParams.get('location_id') || '0');

  if (!supplierId || !locationId) {
    return NextResponse.json({ error: 'supplier_id and location_id required' }, { status: 400 });
  }
  if (!canAccessPurchaseLocation(user, locationId)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const guide = getGuideWithItems(supplierId, locationId);
  return NextResponse.json({ guide });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.guide.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { supplier_id, location_id, product_id, product_name, product_uom, price, price_source, category_name, par_level, product_code } = body;

  if (!supplier_id || !location_id || !product_id) {
    return NextResponse.json({ error: 'supplier_id, location_id, product_id required' }, { status: 400 });
  }
  if (!canAccessPurchaseLocation(user, Number(location_id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  let guide = getGuide(supplier_id, location_id);
  if (!guide) {
    const guideId = createGuide(supplier_id, location_id, '');
    guide = { id: guideId };
  }

  const itemId = addGuideItem(guide.id, {
    product_id, product_name: product_name || '', product_uom: product_uom || 'Units',
    price: price || 0, price_source: price_source || 'manual', category_name: category_name || '',
    par_level: typeof par_level === 'number' ? par_level : 0,
    product_code: typeof product_code === 'string' ? product_code : '',
  });

  return NextResponse.json({ id: itemId, message: 'Item added to guide' }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.guide.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const itemId = parseInt(searchParams.get('item_id') || '0');
  const guideId = parseInt(searchParams.get('guide_id') || '0');
  const supplierId = parseInt(searchParams.get('supplier_id') || '0');
  const locationId = parseInt(searchParams.get('location_id') || '0');

  const db = getDb();

  const locOfItem = (id: number) => (db.prepare('SELECT g.location_id AS loc FROM purchase_guide_items i JOIN purchase_order_guides g ON g.id = i.guide_id WHERE i.id = ?').get(id) as { loc: number } | undefined);
  const locOfGuide = (id: number) => (db.prepare('SELECT location_id AS loc FROM purchase_order_guides WHERE id = ?').get(id) as { loc: number } | undefined);

  // Delete single item
  if (itemId) {
    const r = locOfItem(itemId);
    if (!r || !canAccessPurchaseLocation(user, r.loc)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    removeGuideItem(itemId);
    return NextResponse.json({ message: 'Item removed' });
  }

  // Delete by guide_id
  if (guideId) {
    const r = locOfGuide(guideId);
    if (!r || !canAccessPurchaseLocation(user, r.loc)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const itemsDel = db.prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(guideId);
    const guideDel = db.prepare('DELETE FROM purchase_order_guides WHERE id = ?').run(guideId);
    return NextResponse.json({
      message: 'Order list deleted',
      debug: { items_deleted: itemsDel.changes, guides_deleted: guideDel.changes }
    });
  }

  // Company-scope: a location-scoped delete requires access to that restaurant;
  // the supplier-wide (no-location) branch is destructive across ALL companies →
  // admin only.
  if (supplierId) {
    if (locationId) { if (!canAccessPurchaseLocation(user, locationId)) return NextResponse.json({ error: 'Access denied' }, { status: 403 }); }
    else if (!isUnrestrictedAdmin(user)) return NextResponse.json({ error: 'Only an unrestricted admin can remove a supplier guide across all restaurants' }, { status: 403 });
  }
  // Delete by supplier_id (with or without location)
  if (supplierId) {
    // Step 1: Find ALL guide IDs for this supplier (any location)
    const guides = db.prepare(
      locationId
        ? 'SELECT id FROM purchase_order_guides WHERE supplier_id = ? AND location_id = ?'
        : 'SELECT id FROM purchase_order_guides WHERE supplier_id = ?'
    ).all(...(locationId ? [supplierId, locationId] : [supplierId])) as any[];

    const guideIds = guides.map((g: any) => g.id);
    let itemsDeleted = 0;
    let guidesDeleted = 0;

    // Step 2: Delete items for each guide
    for (const gid of guideIds) {
      const r = db.prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(gid);
      itemsDeleted += r.changes;
    }

    // Step 3: Delete the guide rows themselves
    if (locationId) {
      const r = db.prepare('DELETE FROM purchase_order_guides WHERE supplier_id = ? AND location_id = ?').run(supplierId, locationId);
      guidesDeleted += r.changes;
    } else {
      const r = db.prepare('DELETE FROM purchase_order_guides WHERE supplier_id = ?').run(supplierId);
      guidesDeleted += r.changes;
    }

    // Step 4: Nuclear cleanup — delete any orphaned items that somehow survived
    const orphans = db.prepare(
      'DELETE FROM purchase_guide_items WHERE guide_id NOT IN (SELECT id FROM purchase_order_guides)'
    ).run();

    return NextResponse.json({
      message: 'Order list deleted',
      debug: {
        guide_ids_found: guideIds,
        items_deleted: itemsDeleted,
        guides_deleted: guidesDeleted,
        orphans_cleaned: orphans.changes,
      }
    });
  }

  return NextResponse.json({ error: 'item_id, guide_id, or supplier_id required' }, { status: 400 });
}

export async function PATCH(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.guide.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const db = getDb();
  const itemLoc = (id: number) => (db.prepare('SELECT g.location_id AS loc FROM purchase_guide_items i JOIN purchase_order_guides g ON g.id = i.guide_id WHERE i.id = ?').get(id) as { loc: number } | undefined);

  // Reorder guide items into a custom walk-in order.
  if (Array.isArray(body.item_ids)) {
    const ids = body.item_ids.map((n: unknown) => parseInt(String(n))).filter((n: number) => Number.isInteger(n) && n > 0);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT DISTINCT g.location_id AS loc FROM purchase_guide_items i JOIN purchase_order_guides g ON g.id = i.guide_id WHERE i.id IN (${placeholders})`).all(...ids) as { loc: number }[];
      if (rows.some((r) => !canAccessPurchaseLocation(user, r.loc))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    reorderGuideItems(ids);
    return NextResponse.json({ message: 'Reordered' });
  }

  const { item_id, price, price_source } = body;
  if (!item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 });
  const r = itemLoc(item_id);
  if (!r || !canAccessPurchaseLocation(user, r.loc)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  updateGuideItemPrice(item_id, price, price_source || 'manual');
  return NextResponse.json({ message: 'Price updated' });
}

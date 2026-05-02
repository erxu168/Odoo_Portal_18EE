/**
 * /api/purchase/guides
 * GET    - get guide for a supplier+location
 * POST   - add item to guide (manager+)
 * DELETE - remove item OR delete entire guide (manager+)
 * PATCH  - update item price (manager+)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getGuideWithItems, getGuide, createGuide, addGuideItem, removeGuideItem, updateGuideItemPrice } from '@/lib/purchase-db';
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

  const guide = getGuideWithItems(supplierId, locationId);
  return NextResponse.json({ guide });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { supplier_id, location_id, product_id, product_name, product_uom, price, price_source, category_name } = body;

  if (!supplier_id || !location_id || !product_id) {
    return NextResponse.json({ error: 'supplier_id, location_id, product_id required' }, { status: 400 });
  }

  let guide = getGuide(supplier_id, location_id);
  if (!guide) {
    const guideId = createGuide(supplier_id, location_id, '');
    guide = { id: guideId };
  }

  const itemId = addGuideItem(guide.id, {
    product_id, product_name: product_name || '', product_uom: product_uom || 'Units',
    price: price || 0, price_source: price_source || 'manual', category_name: category_name || '',
  });

  return NextResponse.json({ id: itemId, message: 'Item added to guide' }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const itemId = parseInt(searchParams.get('item_id') || '0');
  const guideId = parseInt(searchParams.get('guide_id') || '0');
  const supplierId = parseInt(searchParams.get('supplier_id') || '0');
  const locationId = parseInt(searchParams.get('location_id') || '0');

  const db = getDb();

  // Delete single item
  if (itemId) {
    removeGuideItem(itemId);
    return NextResponse.json({ message: 'Item removed' });
  }

  // Delete by guide_id
  if (guideId) {
    const itemsDel = db.prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(guideId);
    const guideDel = db.prepare('DELETE FROM purchase_order_guides WHERE id = ?').run(guideId);
    return NextResponse.json({
      message: 'Order list deleted',
      debug: { items_deleted: itemsDel.changes, guides_deleted: guideDel.changes }
    });
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
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { item_id, price, price_source } = body;
  if (!item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 });

  updateGuideItemPrice(item_id, price, price_source || 'manual');
  return NextResponse.json({ message: 'Price updated' });
}

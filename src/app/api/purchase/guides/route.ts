/**
 * /api/purchase/guides
 * GET    - get guide for a supplier+location
 * POST   - add item to guide (manager+)
 * DELETE - remove item from guide OR delete entire guide (manager+)
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

  // Delete by guide_id
  if (guideId) {
    db.prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(guideId);
    db.prepare('DELETE FROM purchase_order_guides WHERE id = ?').run(guideId);
    return NextResponse.json({ message: 'Order list deleted' });
  }

  // Delete by supplier_id + location_id (most reliable - no guide_id lookup needed)
  if (supplierId && locationId) {
    const guide = getGuide(supplierId, locationId);
    if (guide) {
      db.prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(guide.id);
      db.prepare('DELETE FROM purchase_order_guides WHERE id = ?').run(guide.id);
    }
    // Also clean up any orphaned items for this supplier
    db.prepare(`
      DELETE FROM purchase_guide_items WHERE guide_id IN (
        SELECT id FROM purchase_order_guides WHERE supplier_id = ? AND location_id = ?
      )
    `).run(supplierId, locationId);
    db.prepare('DELETE FROM purchase_order_guides WHERE supplier_id = ? AND location_id = ?').run(supplierId, locationId);
    return NextResponse.json({ message: 'Order list deleted' });
  }

  // Delete single item
  if (itemId) {
    removeGuideItem(itemId);
    return NextResponse.json({ message: 'Item removed' });
  }

  return NextResponse.json({ error: 'item_id, guide_id, or supplier_id+location_id required' }, { status: 400 });
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

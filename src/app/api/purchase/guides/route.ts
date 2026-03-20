/**
 * /api/purchase/guides
 * GET    - get guide for a supplier+location
 * POST   - add item to guide (manager+)
 * DELETE - remove item from guide (manager+)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getGuideWithItems, getGuide, createGuide, addGuideItem, removeGuideItem, updateGuideItemPrice } from '@/lib/purchase-db';

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

  // Get or create guide
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
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });

  removeGuideItem(itemId);
  return NextResponse.json({ message: 'Item removed' });
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

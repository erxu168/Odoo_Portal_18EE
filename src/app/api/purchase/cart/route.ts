/**
 * /api/purchase/cart
 * GET  - get all carts for a location (with items + totals)
 * POST - add/update item in shared cart
 * DELETE - clear a cart
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOrCreateCart, upsertCartItem, getAllCartsForLocation, clearCart, getCartWithItems } from '@/lib/purchase-db';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = parseInt(searchParams.get('location_id') || '0');
  const cartId = searchParams.get('cart_id');

  if (cartId) {
    const cart = getCartWithItems(parseInt(cartId));
    return NextResponse.json({ cart });
  }

  if (!locationId) {
    return NextResponse.json({ error: 'location_id required' }, { status: 400 });
  }

  const carts = getAllCartsForLocation(locationId);
  const totalItems = carts.reduce((s: number, c: any) => s + c.item_count, 0);
  const totalAmount = carts.reduce((s: number, c: any) => s + c.total, 0);

  return NextResponse.json({ carts, total_items: totalItems, total_amount: totalAmount });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { location_id, supplier_id, product_id, quantity, product_name, product_uom, price } = body;

  if (!location_id || !supplier_id || !product_id || quantity === undefined) {
    return NextResponse.json({ error: 'location_id, supplier_id, product_id, quantity required' }, { status: 400 });
  }

  const cart = getOrCreateCart(location_id, supplier_id, user.id);
  upsertCartItem(cart.id, product_id, quantity, user.id, { product_name, product_uom, price });

  // Return updated cart
  const updated = getCartWithItems(cart.id);
  return NextResponse.json({ cart: updated });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const cartId = parseInt(searchParams.get('cart_id') || '0');
  if (!cartId) return NextResponse.json({ error: 'cart_id required' }, { status: 400 });

  clearCart(cartId);
  return NextResponse.json({ message: 'Cart cleared' });
}

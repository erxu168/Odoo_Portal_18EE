/**
 * POST /api/purchase/orders/cancel
 * Staff cancels an order that hasn't been sent yet.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOrder, cancelOrder } from '@/lib/purchase-db';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { order_id } = body;
  if (!order_id) return NextResponse.json({ error: 'order_id required' }, { status: 400 });

  const order = getOrder(order_id);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  // Can only cancel draft, pending_approval, or approved (not yet sent)
  if (!['draft', 'pending_approval', 'approved'].includes(order.status)) {
    return NextResponse.json({ error: 'Order cannot be cancelled in current status' }, { status: 400 });
  }

  cancelOrder(order_id, user.id);
  return NextResponse.json({ message: 'Order cancelled' });
}

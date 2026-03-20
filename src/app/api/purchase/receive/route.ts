/**
 * /api/purchase/receive
 * GET  - list orders pending receipt for a location
 * POST - create or update a receipt
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { listOrders, createReceipt, getReceipt, getReceiptByOrder, updateReceiptLine, confirmReceipt, updateReceiptNote, getOrder } from '@/lib/purchase-db';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = parseInt(searchParams.get('location_id') || '0');
  const orderId = searchParams.get('order_id');

  // Get receipt for a specific order
  if (orderId) {
    let receipt = getReceiptByOrder(parseInt(orderId));
    if (!receipt) {
      // Auto-create receipt when viewing
      const rid = createReceipt(parseInt(orderId), user.id);
      if (rid) receipt = getReceipt(rid);
    }
    return NextResponse.json({ receipt });
  }

  if (!locationId) return NextResponse.json({ error: 'location_id required' }, { status: 400 });

  const sentOrders = listOrders(locationId, { status: 'sent' });
  const partialOrders = listOrders(locationId, { status: 'partial' });

  return NextResponse.json({ pending: [...sentOrders, ...partialOrders] });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { action } = body;

  if (action === 'start') {
    const { order_id } = body;
    if (!order_id) return NextResponse.json({ error: 'order_id required' }, { status: 400 });
    const receiptId = createReceipt(order_id, user.id);
    if (!receiptId) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const receipt = getReceipt(receiptId);
    return NextResponse.json({ receipt }, { status: 201 });
  }

  if (action === 'update_line') {
    const { line_id, received_qty, has_issue, issue_type, issue_photo, issue_notes } = body;
    if (!line_id) return NextResponse.json({ error: 'line_id required' }, { status: 400 });
    updateReceiptLine(line_id, { received_qty, has_issue, issue_type, issue_photo, issue_notes });
    return NextResponse.json({ message: 'Line updated' });
  }

  if (action === 'confirm') {
    if (!hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Manager must confirm receipts' }, { status: 403 });
    }
    const { receipt_id, close_order } = body;
    if (!receipt_id) return NextResponse.json({ error: 'receipt_id required' }, { status: 400 });

    confirmReceipt(receipt_id, user.id, close_order !== false);

    // Update stock in Odoo
    const receipt = getReceipt(receipt_id);
    if (receipt) {
      try {
        const odoo = getOdoo();
        for (const line of receipt.lines) {
          if (line.received_qty !== null && line.received_qty > 0) {
            const quants = await odoo.searchRead('stock.quant',
              [['product_id', '=', line.product_id], ['location_id', '=', receipt.location_id]],
              ['id', 'quantity'], { limit: 1 });

            if (quants && quants.length > 0) {
              await odoo.write('stock.quant', [quants[0].id], {
                inventory_quantity: quants[0].quantity + line.received_qty,
              });
              await odoo.call('stock.quant', 'action_apply_inventory', [[quants[0].id]]);
            }
          }
        }
      } catch (e) {
        console.error('Failed to update Odoo stock:', e);
      }
    }

    return NextResponse.json({ message: 'Receipt confirmed and stock updated' });
  }

  if (action === 'delivery_note') {
    const { receipt_id, photo } = body;
    if (!receipt_id || !photo) return NextResponse.json({ error: 'receipt_id and photo required' }, { status: 400 });
    updateReceiptNote(receipt_id, photo);
    return NextResponse.json({ message: 'Delivery note saved' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

/**
 * /api/purchase/orders
 * GET  - list orders for a location
 * POST - create order from cart (submit)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { createOrder, listOrders, getOrder, updateOrderStatus, clearCart, getCartWithItems, getSupplier, countPendingApprovals } from '@/lib/purchase-db';
import { getOdoo } from '@/lib/odoo';
import { LOCATIONS } from '@/types/purchase';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = parseInt(searchParams.get('location_id') || '0');
  const status = searchParams.get('status') || undefined;
  const limit = parseInt(searchParams.get('limit') || '50');

  if (!locationId) return NextResponse.json({ error: 'location_id required' }, { status: 400 });

  const orders = listOrders(locationId, { status, limit });
  const pendingCount = countPendingApprovals(locationId);

  return NextResponse.json({ orders, pending_approvals: pendingCount });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { cart_id, delivery_date, order_note } = body;

  if (!cart_id) return NextResponse.json({ error: 'cart_id required' }, { status: 400 });

  // Get cart with items
  const cart = getCartWithItems(cart_id);
  if (!cart || !cart.items || cart.items.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }

  // Get supplier to check approval requirement
  const supplier = getSupplier(cart.supplier_id) as any;
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  const needsApproval = supplier.approval_required === 1 && !hasRole(user, 'manager');
  const status = needsApproval ? 'pending_approval' : 'approved';

  const total = cart.items.reduce((s: number, i: any) => s + (i.quantity * i.price), 0);

  // Create portal order
  const orderId = createOrder({
    supplier_id: cart.supplier_id,
    location_id: cart.location_id,
    delivery_date: delivery_date || null,
    order_note: order_note || '',
    total_amount: total,
    ordered_by: user.id,
    status,
    lines: cart.items.map((i: any) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      product_uom: i.product_uom,
      quantity: i.quantity,
      price: i.price,
    })),
  });

  // If approved immediately, create Odoo PO and send
  if (status === 'approved') {
    try {
      const poResult = await createOdooPO(orderId, cart, supplier);
      if (poResult) {
        updateOrderStatus(orderId, 'sent', {
          odoo_po_id: poResult.id,
          odoo_po_name: poResult.name,
          sent_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error('Failed to create Odoo PO:', e);
      // Order still created in portal, just not synced
    }
  }

  // Clear the cart
  clearCart(cart_id);

  const order = getOrder(orderId);
  return NextResponse.json({ order, message: needsApproval ? 'Order queued for approval' : 'Order sent' }, { status: 201 });
}

/**
 * Create a draft purchase.order in Odoo 18 EE.
 */
async function createOdooPO(orderId: number, cart: any, supplier: any) {
  const odoo = getOdoo();
  const locKey = cart.location_id === 32 ? 'SSAM' : 'GBM38';
  const loc = LOCATIONS[locKey as keyof typeof LOCATIONS];

  // Build order lines in Odoo format: (0, 0, { ... })
  const order = getOrder(orderId);
  if (!order) return null;

  const orderLines = order.lines.map((line: any) => [
    0, 0, {
      product_id: line.product_id,
      product_qty: line.quantity,
      price_unit: line.price,
      name: line.product_name,
    }
  ]);

  const poId = await odoo.create('purchase.order', {
    partner_id: supplier.odoo_partner_id,
    company_id: loc.company_id,
    picking_type_id: loc.picking_type_id,
    order_line: orderLines,
    origin: `Portal Order #${orderId}`,
  });

  // Read back the PO name
  const pos = await odoo.searchRead('purchase.order',
    [['id', '=', poId]], ['name'], { limit: 1 });
  const poName = pos?.[0]?.name || `PO-${poId}`;

  // Confirm the PO in Odoo (draft -> purchase)
  try {
    await odoo.call('purchase.order', 'button_confirm', [[poId]]);
  } catch (e) {
    console.error('Failed to confirm PO in Odoo:', e);
  }

  return { id: poId, name: poName };
}

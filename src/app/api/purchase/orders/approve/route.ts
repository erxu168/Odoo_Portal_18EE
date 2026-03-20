/**
 * POST /api/purchase/orders/approve
 * Manager approves or rejects a pending order.
 * On approve: creates Odoo PO and auto-sends.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOrder, updateOrderStatus, getSupplier, countPendingApprovals } from '@/lib/purchase-db';
import { getOdoo } from '@/lib/odoo';
import { LOCATIONS } from '@/types/purchase';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { order_id, action } = body;

  if (!order_id || !action) {
    return NextResponse.json({ error: 'order_id and action required' }, { status: 400 });
  }

  const order = getOrder(order_id);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.status !== 'pending_approval') {
    return NextResponse.json({ error: 'Order is not pending approval' }, { status: 400 });
  }

  if (action === 'reject') {
    updateOrderStatus(order_id, 'cancelled');
    return NextResponse.json({ message: 'Order rejected' });
  }

  if (action === 'approve') {
    const supplier = getSupplier(order.supplier_id) as any;
    if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    // Create Odoo PO
    try {
      const odoo = getOdoo();
      const locKey = order.location_id === 32 ? 'SSAM' : 'GBM38';
      const loc = LOCATIONS[locKey as keyof typeof LOCATIONS];

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
        origin: `Portal Order #${order_id}`,
      });

      const pos = await odoo.searchRead('purchase.order',
        [['id', '=', poId]], ['name'], { limit: 1 });
      const poName = pos?.[0]?.name || `PO-${poId}`;

      try {
        await odoo.call('purchase.order', 'button_confirm', [[poId]]);
      } catch (_e) { /* ignore confirm failure */ }

      updateOrderStatus(order_id, 'sent', {
        odoo_po_id: poId,
        odoo_po_name: poName,
        approved_by: user.id,
        sent_at: new Date().toISOString(),
      });

      return NextResponse.json({ message: `Order approved and sent as ${poName}`, odoo_po_name: poName });
    } catch (e: any) {
      console.error('Failed to create Odoo PO on approval:', e);
      // Still mark approved even if Odoo sync fails
      updateOrderStatus(order_id, 'approved', { approved_by: user.id });
      return NextResponse.json({ message: 'Order approved but Odoo sync failed. Manual PO needed.', warning: true });
    }
  }

  return NextResponse.json({ error: 'Invalid action. Use approve or reject.' }, { status: 400 });
}

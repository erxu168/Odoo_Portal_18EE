import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/purchase/orders
 *
 * Returns purchase orders grouped by status.
 * Maps to: purchase.order + purchase.delivery.check
 */
export async function GET() {
  try {
    const odoo = getOdoo();

    // Fetch all purchase orders (recent first)
    const orders = await odoo.searchRead(
      'purchase.order',
      [['state', 'in', ['draft', 'sent', 'purchase', 'done']]],
      [
        'name', 'partner_id', 'state', 'date_order', 'date_planned',
        'amount_total', 'amount_untaxed', 'currency_id', 'origin',
        'order_line', 'delivery_checked', 'user_id'
      ],
      { order: 'date_order desc', limit: 100 }
    );

    const result = orders.map((po: any) => {
      // Determine display status
      let displayStatus: string;
      if (po.state === 'draft') displayStatus = 'draft';
      else if (po.state === 'sent') displayStatus = 'sent';
      else if (po.state === 'purchase' && !po.delivery_checked) displayStatus = 'to_receive';
      else if (po.state === 'purchase' && po.delivery_checked) displayStatus = 'completed';
      else if (po.state === 'done') displayStatus = 'completed';
      else displayStatus = po.state;

      return {
        id: po.id,
        name: po.name,
        partnerId: po.partner_id ? po.partner_id[0] : null,
        partnerName: po.partner_id ? po.partner_id[1] : '',
        state: po.state,
        displayStatus,
        dateOrder: po.date_order || '',
        datePlanned: po.date_planned || '',
        amountTotal: po.amount_total || 0,
        amountUntaxed: po.amount_untaxed || 0,
        currencySymbol: '€',
        origin: po.origin || '',
        lineCount: po.order_line?.length || 0,
        deliveryChecked: po.delivery_checked || false,
        userId: po.user_id ? po.user_id[1] : '',
      };
    });

    return NextResponse.json({ orders: result });
  } catch (err: any) {
    console.error('[API] GET /purchase/orders error:', err.message);
    return NextResponse.json(
      { error: 'Failed to load orders', detail: err.message },
      { status: 500 }
    );
  }
}

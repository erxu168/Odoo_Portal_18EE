import { NextRequest, NextResponse } from 'next/server';
import { OdooClient } from '@/lib/odoo';
import { getKdsSettings } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    const configId = Number(req.nextUrl.searchParams.get('configId')) || settings.posConfigId;

    if (!configId) {
      return NextResponse.json({ orders: [], error: 'No POS config ID set' });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    const rawOrders = await odoo.searchRead(
      'pos.order',
      [
        ['state', '=', 'paid'],
        ['config_id', '=', configId],
      ],
      ['id', 'name', 'tracking_number', 'date_order', 'takeaway', 'amount_total', 'general_note'],
      { order: 'date_order ASC', limit: 50 }
    );

    if (rawOrders.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    const orderIds = rawOrders.map((o: any) => o.id);

    const rawLines = await odoo.searchRead(
      'pos.order.line',
      [['order_id', 'in', orderIds]],
      ['id', 'order_id', 'full_product_name', 'qty', 'note', 'customer_note'],
      { limit: 500 }
    );

    const linesByOrder: Record<number, any[]> = {};
    for (const line of rawLines) {
      const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      if (!linesByOrder[oid]) linesByOrder[oid] = [];
      linesByOrder[oid].push(line);
    }

    const now = Date.now();
    const orders = rawOrders.map((o: any) => {
      const orderDate = new Date(o.date_order.replace(' ', 'T') + 'Z');
      const waitMin = Math.max(0, Math.floor((now - orderDate.getTime()) / 60000));
      const lines = linesByOrder[o.id] || [];
      const trackingNum = o.tracking_number
        ? String(o.tracking_number)
        : o.name?.split('/').pop() || String(o.id);

      return {
        id: o.id,
        table: `#${trackingNum}`,
        type: o.takeaway ? 'Takeaway' : 'Dine-in',
        waitMin,
        status: 'prep',
        readyAt: null,
        doneAt: null,
        items: lines.map((l: any) => ({
          id: String(l.id),
          name: l.full_product_name || 'Unknown',
          qty: l.qty || 1,
          note: l.note || l.customer_note || undefined,
          done: false,
        })),
      };
    });

    return NextResponse.json({ orders });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] orders fetch error:', msg);
    return NextResponse.json({ orders: [], error: msg }, { status: 500 });
  }
}

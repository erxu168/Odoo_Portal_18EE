import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { getKdsSettings, getCompletedOrders } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

/**
 * KDS order feed. READ-ONLY against Odoo -- the KDS never writes to pos.order.
 *
 * Ticket trigger (hybrid):
 *   - paid orders (counter service: customer pays, ticket fires), OR
 *   - draft orders whose last_order_preparation_change contains lines
 *     (table service: waiter pressed the Order button to fire to kitchen).
 * Half-entered draft orders never appear.
 *
 * Scope: current service day, starting 05:00 Europe/Berlin. Orders placed
 * after midnight belong to the previous service day until 05:00.
 *
 * Ready/Done stages come from the portal SQLite (kds_completed_orders),
 * so the pass state survives tablet reboots without touching Odoo.
 */

/** Start of the current service day (05:00 Berlin) as a UTC Odoo datetime string. */
function serviceDayStartUtc(): string {
  const berlinNow = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' });
  let dateStr = berlinNow.slice(0, 10);
  const hour = Number(berlinNow.slice(11, 13));
  if (hour < 5) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    dateStr = d.toISOString().slice(0, 10);
  }
  // Resolve the Berlin UTC offset (CET +01:00 / CEST +02:00) for that date.
  for (const off of ['+02:00', '+01:00']) {
    const d = new Date(`${dateStr}T05:00:00${off}`);
    const back = d.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' });
    if (back.startsWith(`${dateStr} 05:00`)) {
      return d.toISOString().slice(0, 19).replace('T', ' ');
    }
  }
  return `${dateStr} 03:00:00`;
}

/** True when the waiter fired this order to the kitchen via the Order button. */
function hasFiredLines(raw: unknown): boolean {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(
      parsed && typeof parsed === 'object' &&
      parsed.lines && Object.keys(parsed.lines).length > 0
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    const configId = Number(req.nextUrl.searchParams.get('configId')) || settings.posConfigId;

    if (!configId) {
      return NextResponse.json({ orders: [], error: 'No POS config ID set' });
    }

    const odoo = getOdoo();

    const rawOrders = await odoo.searchRead(
      'pos.order',
      [
        ['config_id', '=', configId],
        ['date_order', '>=', serviceDayStartUtc()],
        ['state', 'in', ['draft', 'paid']],
      ],
      [
        'id', 'name', 'state', 'tracking_number', 'date_order', 'takeaway',
        'table_id', 'general_note', 'last_order_preparation_change',
      ],
      { order: 'date_order ASC', limit: 80 }
    );

    // Hybrid trigger: drafts only count once they were fired to the kitchen.
    const fired = rawOrders.filter((o: any) =>
      o.state === 'paid' || hasFiredLines(o.last_order_preparation_change)
    );

    if (fired.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    const orderIds = fired.map((o: any) => o.id);

    const rawLines = await odoo.searchRead(
      'pos.order.line',
      [
        ['order_id', 'in', orderIds],
        ['qty', '>', 0], // exclude refund lines
      ],
      ['id', 'order_id', 'full_product_name', 'qty', 'note', 'customer_note'],
      { limit: 800 }
    );

    const linesByOrder: Record<number, any[]> = {};
    for (const line of rawLines) {
      const oid = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
      if (!linesByOrder[oid]) linesByOrder[oid] = [];
      linesByOrder[oid].push(line);
    }

    // Ready/Done overlay persisted in portal SQLite.
    const stageByOrder = new Map<number, { stage: 'ready' | 'done'; ready_at: number | null; done_at: number | null }>();
    for (const row of getCompletedOrders()) {
      stageByOrder.set(row.order_id, { stage: row.stage, ready_at: row.ready_at, done_at: row.done_at });
    }

    const now = Date.now();
    const orders = fired
      .map((o: any) => {
        const lines = linesByOrder[o.id] || [];
        if (lines.length === 0) return null; // refund-only or empty order

        const orderDate = new Date(o.date_order.replace(' ', 'T') + 'Z');
        const waitMin = Math.max(0, Math.floor((now - orderDate.getTime()) / 60000));

        const tableName = Array.isArray(o.table_id) ? String(o.table_id[1]) : '';
        const trackingNum = o.tracking_number
          ? String(o.tracking_number)
          : o.name?.split('/').pop() || String(o.id);
        const label = tableName ? tableName : `#${trackingNum}`;

        const staged = stageByOrder.get(o.id);

        return {
          id: o.id,
          table: label,
          type: o.takeaway ? 'Takeaway' : 'Dine-in',
          waitMin,
          status: staged ? staged.stage : 'prep',
          readyAt: staged ? staged.ready_at : null,
          doneAt: staged ? staged.done_at : null,
          items: lines.map((l: any) => ({
            id: String(l.id),
            name: l.full_product_name || 'Unknown',
            qty: l.qty || 1,
            note: l.note || l.customer_note || undefined,
            done: false,
          })),
        };
      })
      .filter((o: any) => o !== null);

    return NextResponse.json({ orders });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] orders fetch error:', msg);
    return NextResponse.json({ orders: [], error: msg }, { status: 500 });
  }
}

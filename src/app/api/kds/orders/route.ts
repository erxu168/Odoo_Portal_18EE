import { NextRequest, NextResponse } from 'next/server';
import { getKdsSettings, getCompletedOrders } from '@/lib/kds-db';
import { getReadyLineIds } from '@/lib/cooktimer-db';
import { fetchFiredOrders } from '@/lib/kds-order-feed';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

/**
 * KDS order feed. READ-ONLY against Odoo -- the KDS never writes to pos.order.
 *
 * Ticket trigger (hybrid), 05:00 Berlin service-day floor, and refund-line
 * exclusion all live in the shared feed helper (src/lib/kds-order-feed.ts),
 * which the Cooking Timer queue reuses. Ready/Done stages come from portal
 * SQLite (kds_completed_orders). A per-LINE ✓ overlay (kds_line_ready) marks
 * lines the Cooking Timer has finished cooking.
 */
export async function GET(req: NextRequest) {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    const configId = Number(req.nextUrl.searchParams.get('configId')) || settings.posConfigId;

    if (!configId) {
      return NextResponse.json({ orders: [], error: 'No POS config ID set' });
    }

    const { firedOrders, linesByOrder } = await fetchFiredOrders(configId);

    if (firedOrders.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    // Ready/Done overlay persisted in portal SQLite.
    const stageByOrder = new Map<number, { stage: 'ready' | 'done'; ready_at: number | null; done_at: number | null }>();
    for (const row of getCompletedOrders()) {
      stageByOrder.set(row.order_id, { stage: row.stage, ready_at: row.ready_at, done_at: row.done_at });
    }
    // Per-line "cooked by the Cooking Timer" overlay.
    const readyLineIds = getReadyLineIds();

    const now = Date.now();
    const orders = firedOrders
      .map((o) => {
        const lines = linesByOrder[o.id] || [];
        if (lines.length === 0) return null; // refund-only or empty order

        const orderDate = new Date((o.date_order as string).replace(' ', 'T') + 'Z');
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
          items: lines.map((l) => ({
            id: String(l.id),
            name: (l.full_product_name as string) || 'Unknown',
            qty: (l.qty as number) || 1,
            note: (l.note as string) || (l.customer_note as string) || undefined,
            done: false,
            timerReady: readyLineIds.has(l.id as number),
          })),
        };
      })
      .filter((o) => o !== null);

    return NextResponse.json({ orders });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] orders fetch error:', msg);
    return NextResponse.json({ orders: [], error: msg }, { status: 500 });
  }
}

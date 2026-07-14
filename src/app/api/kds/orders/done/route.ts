import { NextRequest, NextResponse } from 'next/server';
import { setOrderStage, clearOrderStage, getCompletedOrders, recordPrep } from '@/lib/kds-db';
import { getOdoo } from '@/lib/odoo';

/**
 * Persist KDS order stage (ready / done) in the portal SQLite.
 *
 * IMPORTANT: This endpoint intentionally does NOT write order state back to
 * Odoo. Forcing pos.order.state bypasses the POS workflow and corrupts session
 * closing and accounting. The KDS is read-only towards Odoo; kitchen progress
 * lives entirely in the portal database.
 *
 * On 'done' it additionally records a permanent prep-time row (order placed →
 * done) for the Sales dashboard "Kitchen" tab. That write is best-effort: any
 * failure is swallowed so the kitchen flow is never blocked.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { orderId: number; stage?: 'ready' | 'done' | 'clear' };
    const orderId = body.orderId;
    const stage = body.stage || 'ready';

    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    if (stage === 'clear') {
      clearOrderStage(orderId);
    } else {
      setOrderStage(orderId, stage);
      if (stage === 'done') {
        await archivePrepTime(orderId).catch((e) => {
          console.warn('[KDS] prep archive skipped for order', orderId, e instanceof Error ? e.message : e);
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] order stage error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Read the order's start time from Odoo and persist a permanent prep-time row. */
async function archivePrepTime(orderId: number): Promise<void> {
  const row = getCompletedOrders().find(r => r.order_id === orderId);
  const doneAt = row?.done_at ?? Date.now();
  const readyAt = row?.ready_at ?? null;

  const odoo = getOdoo();
  const orders = await odoo.searchRead(
    'pos.order',
    [['id', '=', orderId]],
    ['date_order', 'company_id', 'config_id'],
    { limit: 1 },
  );
  if (!orders.length) return; // order not visible (deleted / not this company) — keep the live timer only
  const o = orders[0] as { date_order: string; company_id: [number, string]; config_id?: [number, string] };
  const startedAt = Date.parse(o.date_order.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(startedAt)) return;

  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(startedAt));

  recordPrep({
    orderId,
    companyId: o.company_id ? o.company_id[0] : 0,
    configId: o.config_id ? o.config_id[0] : null,
    day,
    startedAt,
    readyAt,
    doneAt,
    prepMs: doneAt - startedAt,
  });
}

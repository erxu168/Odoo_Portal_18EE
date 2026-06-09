import { NextRequest, NextResponse } from 'next/server';
import { setOrderStage, clearOrderStage } from '@/lib/kds-db';

/**
 * Persist KDS order stage (ready / done) in the portal SQLite.
 *
 * IMPORTANT: This endpoint intentionally does NOT write to Odoo.
 * Forcing pos.order.state bypasses the POS workflow and corrupts
 * session closing and accounting. The KDS is read-only towards Odoo;
 * kitchen progress lives entirely in the portal database.
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
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] order stage error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

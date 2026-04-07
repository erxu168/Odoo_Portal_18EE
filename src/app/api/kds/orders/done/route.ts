import { NextRequest, NextResponse } from 'next/server';
import { OdooClient } from '@/lib/odoo';

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json() as { orderId: number };

    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    await odoo.write('pos.order', [orderId], { state: 'done' });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] mark done error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

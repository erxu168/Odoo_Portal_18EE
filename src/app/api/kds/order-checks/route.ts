import { NextRequest, NextResponse } from 'next/server';
import { getOrderChecks, setOrderCheck, clearOrderChecks } from '@/lib/kds-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = getOrderChecks();
    return NextResponse.json({ checks: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ checks: [], error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      orderId?: number;
      itemId?: string;
      checked?: boolean;
      clearOrder?: number;
    };

    if (typeof body.clearOrder === 'number') {
      clearOrderChecks(body.clearOrder);
      return NextResponse.json({ ok: true });
    }

    if (typeof body.orderId !== 'number' || typeof body.itemId !== 'string' || typeof body.checked !== 'boolean') {
      return NextResponse.json({ error: 'orderId, itemId, checked required' }, { status: 400 });
    }

    setOrderCheck(body.orderId, body.itemId, body.checked);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

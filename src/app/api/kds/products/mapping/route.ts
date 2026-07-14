import { NextRequest, NextResponse } from 'next/server';
import { setProductMapping } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { productName?: string; sourceStation?: string; prepType?: string };
    if (!body.productName || !body.sourceStation || !body.prepType) {
      return NextResponse.json({ error: 'productName, sourceStation, prepType required' }, { status: 400 });
    }
    setProductMapping(KDS_LOCATION_ID, body.productName, body.sourceStation, body.prepType);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getProductConfig } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = getProductConfig(KDS_LOCATION_ID);
    const config = rows.map(r => ({
      productName: r.product_name,
      sourceStation: r.source_station,
      prepType: r.prep_type,
    }));
    return NextResponse.json({ config });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ config: [], error: msg }, { status: 500 });
  }
}

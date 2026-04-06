import { NextRequest, NextResponse } from 'next/server';
import { getKdsSettings, saveKdsSettings } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';
import type { KdsSettings } from '@/types/kds';

export async function GET() {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    return NextResponse.json(settings);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<KdsSettings>;
    const current = getKdsSettings(KDS_LOCATION_ID);
    const merged: KdsSettings = { ...current, ...body, locationId: KDS_LOCATION_ID };
    saveKdsSettings(merged);
    return NextResponse.json(merged);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

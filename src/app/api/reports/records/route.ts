import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { LOCATIONS } from '@/lib/report-queries';
import { computeRecords } from '@/lib/report-compute';
import { cacheGet, cacheSet, cacheKey, REPORT_TTL } from '@/lib/report-cache';

export async function GET(req: NextRequest) {
  try {
    requireRole('manager');

    const { searchParams } = new URL(req.url);
    const locationId = parseInt(searchParams.get('location') || '7');
    const refDate = searchParams.get('date') || new Date().toISOString().substring(0, 10);

    const location = LOCATIONS.find(l => l.id === locationId);
    if (!location) return NextResponse.json({ success: false, error: 'Invalid location' }, { status: 400 });

    const key = cacheKey('records', locationId, refDate);
    const cached = cacheGet<any>(key);
    if (cached) return NextResponse.json({ success: true, data: cached.data, cached: true, computedAt: cached.computedAt });

    const data = await computeRecords(location, refDate);
    cacheSet(key, data, REPORT_TTL.records);
    return NextResponse.json({ success: true, data, cached: false, computedAt: new Date().toISOString() });
  } catch (err: any) {
    if (err instanceof AuthError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[reports/records]', err);
    return NextResponse.json({ success: false, error: err.message || 'Unknown error' }, { status: 500 });
  }
}

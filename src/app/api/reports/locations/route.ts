import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { computeLocationComparison } from '@/lib/report-compute';
import { cacheGet, cacheSet, cacheKey, REPORT_TTL } from '@/lib/report-cache';

export async function GET(req: NextRequest) {
  try {
    requireRole('manager');

    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get('month') || new Date().toISOString().substring(0, 7);
    const [yearStr, monthStr] = monthParam.split('-');

    const key = cacheKey('locations', 'all', monthParam);
    const cached = cacheGet<any>(key);
    if (cached) return NextResponse.json({ success: true, data: cached.data, cached: true, computedAt: cached.computedAt });

    const data = await computeLocationComparison(parseInt(yearStr), parseInt(monthStr));
    cacheSet(key, data, REPORT_TTL.locations);
    return NextResponse.json({ success: true, data, cached: false, computedAt: new Date().toISOString() });
  } catch (err: any) {
    if (err instanceof AuthError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[reports/locations]', err);
    return NextResponse.json({ success: false, error: err.message || 'Unknown error' }, { status: 500 });
  }
}

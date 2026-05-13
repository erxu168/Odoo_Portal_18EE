import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { LOCATIONS } from '@/lib/report-queries';
import { computePnl } from '@/lib/report-compute';
import { cacheGet, cacheSet, cacheKey, REPORT_TTL } from '@/lib/report-cache';

// P&L is admin-only (financial detail)
export async function GET(req: NextRequest) {
  try {
    requireRole('admin');

    const { searchParams } = new URL(req.url);
    const locationId = parseInt(searchParams.get('location') || '7');
    const monthParam = searchParams.get('month') || new Date().toISOString().substring(0, 7);
    const [yearStr, monthStr] = monthParam.split('-');

    const location = LOCATIONS.find(l => l.id === locationId);
    if (!location) return NextResponse.json({ success: false, error: 'Invalid location' }, { status: 400 });

    const key = cacheKey('pnl', locationId, monthParam);
    const cached = cacheGet<any>(key);
    if (cached) return NextResponse.json({ success: true, data: cached.data, cached: true, computedAt: cached.computedAt });

    const data = await computePnl(location, parseInt(yearStr), parseInt(monthStr));
    cacheSet(key, data, REPORT_TTL.pnl);
    return NextResponse.json({ success: true, data, cached: false, computedAt: new Date().toISOString() });
  } catch (err: any) {
    if (err instanceof AuthError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[reports/pnl]', err);
    return NextResponse.json({ success: false, error: err.message || 'Unknown error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { LOCATIONS } from '@/lib/report-queries';
import { computeDashboard } from '@/lib/report-compute';
import { cacheGet, cacheSet, cacheKey, REPORT_TTL } from '@/lib/report-cache';

export async function GET(req: NextRequest) {
  try {
    requireRole('manager');

    const { searchParams } = new URL(req.url);
    const locationId = parseInt(searchParams.get('location') || '7');
    const today = searchParams.get('today') || new Date().toISOString().substring(0, 10);

    const location = LOCATIONS.find(l => l.id === locationId);
    if (!location) return NextResponse.json({ success: false, error: 'Invalid location' }, { status: 400 });

    const key = cacheKey('dashboard', locationId, today);
    const cached = cacheGet<any>(key);
    if (cached) return NextResponse.json({ success: true, data: cached.data, cached: true, computedAt: cached.computedAt });

    const data = await computeDashboard(location, today);
    cacheSet(key, data, REPORT_TTL.dashboard_today);
    return NextResponse.json({ success: true, data, cached: false, computedAt: new Date().toISOString() });
  } catch (err: any) {
    if (err instanceof AuthError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[reports/dashboard]', err);
    return NextResponse.json({ success: false, error: err.message || 'Unknown error' }, { status: 500 });
  }
}

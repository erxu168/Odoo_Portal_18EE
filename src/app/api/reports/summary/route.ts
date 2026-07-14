import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { computeOwnerReport } from '@/lib/report-compute';
import { cacheGet, cacheSet, cacheKey, REPORT_TTL } from '@/lib/report-cache';

// Owner report is admin-only
export async function GET(req: NextRequest) {
  try {
    requireRole('admin');

    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get('month') || new Date().toISOString().substring(0, 7);
    const [yearStr, monthStr] = monthParam.split('-');

    const key = cacheKey('summary', 'all', monthParam);
    const cached = cacheGet<any>(key);
    if (cached) return NextResponse.json({ success: true, data: cached.data, cached: true, computedAt: cached.computedAt });

    const data = await computeOwnerReport(parseInt(yearStr), parseInt(monthStr));
    cacheSet(key, data, REPORT_TTL.summary);
    return NextResponse.json({ success: true, data, cached: false, computedAt: new Date().toISOString() });
  } catch (err: any) {
    if (err instanceof AuthError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error('[reports/summary]', err);
    return NextResponse.json({ success: false, error: err.message || 'Unknown error' }, { status: 500 });
  }
}

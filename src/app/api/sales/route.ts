import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { computeSales, type Range } from '@/lib/waj-sales';
import { cacheGet, cacheSet, cacheKey } from '@/lib/report-cache';

// Short TTLs so the client's ~3-min auto-refresh actually shows movement,
// while still shielding Odoo from repeated hits.
const TTL: Record<Range, number> = { today: 120, week: 600, month: 900 };
const RANGES: Range[] = ['today', 'week', 'month'];

export async function GET(req: NextRequest) {
  try {
    requireRole('manager');

    const { searchParams } = new URL(req.url);
    const range = (searchParams.get('range') || 'week') as Range;
    if (!RANGES.includes(range)) {
      return NextResponse.json({ success: false, error: 'Invalid range' }, { status: 400 });
    }

    const dayStamp = new Date().toISOString().slice(0, 10);
    const key = cacheKey('waj-sales', range, dayStamp);
    const cached = cacheGet<any>(key);
    if (cached) {
      return NextResponse.json({ success: true, data: cached.data, cached: true, computedAt: cached.computedAt });
    }

    const data = await computeSales(range, Date.now());
    cacheSet(key, data, TTL[range]);
    return NextResponse.json({ success: true, data, cached: false, computedAt: new Date().toISOString() });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/sales]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

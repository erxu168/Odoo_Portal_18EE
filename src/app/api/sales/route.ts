import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { computeSales, type Range } from '@/lib/waj-sales';
import { cacheGet, cacheSet, cacheKey } from '@/lib/report-cache';

// Short TTLs so the client's ~3-min auto-refresh shows movement on live periods,
// while still shielding Odoo. Past periods rarely change but are cheap to recache.
const TTL: Record<Range, number> = { today: 120, week: 600, month: 900, ytd: 900, year: 1800 };
const RANGES: Range[] = ['today', 'week', 'month', 'ytd', 'year'];

function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** True only for a real calendar date within the supported range. */
function validAnchor(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export async function GET(req: NextRequest) {
  try {
    requireRole('manager');

    const { searchParams } = new URL(req.url);
    const range = (searchParams.get('range') || 'week') as Range;
    if (!RANGES.includes(range)) {
      return NextResponse.json({ success: false, error: 'Invalid range' }, { status: 400 });
    }
    const raw = searchParams.get('anchor') || '';
    const anchor = validAnchor(raw) ? raw : berlinToday();

    const key = cacheKey('waj-sales', range, anchor);
    const cached = cacheGet<any>(key);
    if (cached) {
      return NextResponse.json({ success: true, data: cached.data, cached: true, computedAt: cached.computedAt });
    }

    const data = await computeSales(range, anchor, Date.now());
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

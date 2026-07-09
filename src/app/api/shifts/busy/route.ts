/**
 * GET /api/shifts/busy?company_id=&weeks=12
 *
 * "Busy times" — how many POS orders came in by weekday × 2-hour slot over the
 * last N weeks, so managers can see when they're actually busy. Read-only,
 * manager-only. This is the honest first step of demand-based staffing: it works
 * with whatever sales history exists and is the base for headcount suggestions.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, serverError } from '../_manager';
import { getCompanySetting, setCompanySetting } from '@/lib/db';
import { fetchOrders } from '@/lib/report-queries';
import { berlinParts, nowOdooUtc } from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

const DEFAULT_ORDERS_PER_PERSON = 8;
const DEFAULT_MIN_STAFF = 1;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** ISO weekday 1..7 (Mon..Sun) of a "YYYY-MM-DD" date. */
function dowOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    let weeks = parseInt(searchParams.get('weeks') || '12', 10);
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) weeks = 12;

    const today = berlinParts(nowOdooUtc()).date;
    const startDate = addDays(today, -weeks * 7);

    const orders = (await fetchOrders(auth.companyId, startDate, today)) as { date_order?: unknown }[];

    // grid[dow 0..6 (Mon..Sun)][bucket 0..11 (each = 2h)] = order count
    const grid: number[][] = Array.from({ length: 7 }, () => Array(12).fill(0));
    let total = 0;
    let minDate = today; // earliest order date (for the per-occurrence average)
    for (const o of orders) {
      const dt = typeof o.date_order === 'string' ? o.date_order : '';
      if (!dt) continue;
      const p = berlinParts(dt); // dow 1..7, hhmm
      const hour = parseInt(p.hhmm.split(':')[0], 10);
      if (!Number.isFinite(hour)) continue;
      const bucket = Math.min(11, Math.max(0, Math.floor(hour / 2)));
      grid[p.dow - 1][bucket] += 1;
      total += 1;
      if (p.date < minDate) minDate = p.date;
    }

    // How many times each weekday occurred across the active data span (first
    // order → today), so we can turn totals into a per-day average.
    const occ = [0, 0, 0, 0, 0, 0, 0];
    let cur = minDate;
    for (let guard = 0; cur <= today && guard < 400; guard++) {
      occ[dowOfDate(cur) - 1] += 1;
      cur = addDays(cur, 1);
    }
    const avgGrid = grid.map((row, d) => row.map(c => (occ[d] > 0 ? Math.round((c / occ[d]) * 10) / 10 : 0)));

    // Which 2h slots ever have orders (so the UI only renders active hours).
    const activeBuckets: number[] = [];
    let maxCell = 0;
    let busiest: { dow: number; bucket: number; count: number } | null = null;
    for (let b = 0; b < 12; b++) {
      let colTotal = 0;
      for (let d = 0; d < 7; d++) {
        const c = grid[d][b];
        colTotal += c;
        if (c > maxCell) maxCell = c;
        if (c > 0 && (busiest === null || c > busiest.count)) {
          busiest = { dow: d + 1, bucket: b, count: c };
        }
      }
      if (colTotal > 0) activeBuckets.push(b);
    }

    const ordersPerPerson = Math.max(
      1,
      parseFloat(getCompanySetting(auth.companyId, 'busy_orders_per_person') || '') || DEFAULT_ORDERS_PER_PERSON,
    );
    const minStaff = Math.max(
      0,
      parseInt(getCompanySetting(auth.companyId, 'busy_min_staff') || '', 10) || DEFAULT_MIN_STAFF,
    );

    return NextResponse.json({
      weeks,
      startDate,
      endDate: today,
      totalOrders: total,
      maxCell,
      activeBuckets,
      grid,
      avgGrid,
      busiest,
      ordersPerPerson,
      minStaff,
    });
  } catch (err: unknown) {
    return serverError('GET busy', err);
  }
}

/** PUT — save the staffing dials (orders per person / minimum staff) per company. */
export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const opp = Number(body.ordersPerPerson);
    const min = Number(body.minStaff);
    if (Number.isFinite(opp) && opp >= 1 && opp <= 100) {
      setCompanySetting(auth.companyId, 'busy_orders_per_person', String(opp));
    }
    if (Number.isFinite(min) && min >= 0 && min <= 20) {
      setCompanySetting(auth.companyId, 'busy_min_staff', String(Math.round(min)));
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('PUT busy', err);
  }
}

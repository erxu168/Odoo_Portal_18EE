/**
 * GET /api/shifts/coverage?company_id=&week= — per-day coverage overview.
 *
 * For each of the week's 7 Berlin days: total shifts, open (unassigned) count
 * and over-cap count, plus week totals for the three stat chips.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchWeekSlots } from '@/lib/shifts-odoo';
import { berlinParts, weekKeyDays } from '@/lib/shifts-time';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const weekKey = resolveWeekKey(req.nextUrl.searchParams.get('week'));
    if (!weekKey) {
      return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
    }

    const slots = await fetchWeekSlots(companyId, weekKey);
    const dayList = weekKeyDays(weekKey);
    const dayIndex = new Map(dayList.map((d, i) => [d, i]));
    const days = dayList.map(date => ({ date, shifts: 0, open: 0, overCap: 0 }));
    const totals = { shifts: 0, open: 0, overCap: 0 };

    for (const slot of slots) {
      const idx = dayIndex.get(berlinParts(slot.start).date);
      if (idx === undefined) continue;
      days[idx].shifts++;
      totals.shifts++;
      if (slot.resourceId === null) {
        days[idx].open++;
        totals.open++;
      }
      if (slot.overCap) {
        days[idx].overCap++;
        totals.overCap++;
      }
    }

    return NextResponse.json({ weekKey, days, totals });
  } catch (err: unknown) {
    return serverError('GET coverage', err);
  }
}

/**
 * GET /api/shifts/coverage?company_id=&week= — per-day coverage overview.
 *
 * For each of the week's 7 Berlin days: total shifts, open (unassigned) count
 * and over-cap count, plus week totals for the three stat chips.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchEmployees, fetchWeekSlots, MIN_WAGE_EUR } from '@/lib/shifts-odoo';
import { confirmedSlotIds } from '@/lib/shifts-db';
import { berlinParts, odooToDate, weekKeyDays } from '@/lib/shifts-time';
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

    const [slots, employees] = await Promise.all([
      fetchWeekSlots(companyId, weekKey),
      fetchEmployees(companyId),
    ]);
    const rateMap = new Map(employees.map(e => [e.id, e.hourlyRate]));
    const dayList = weekKeyDays(weekKey);
    const dayIndex = new Map(dayList.map((d, i) => [d, i]));
    const days = dayList.map(date => ({ date, shifts: 0, open: 0, overCap: 0, cost: 0 }));
    const totals = { shifts: 0, open: 0, overCap: 0, cost: 0 };

    for (const slot of slots) {
      const idx = dayIndex.get(berlinParts(slot.start).date);
      if (idx === undefined) continue;
      days[idx].shifts++;
      totals.shifts++;
      if (slot.resourceId === null) {
        days[idx].open++;
        totals.open++;
      } else if (slot.employeeId !== null) {
        const cost = slot.hours * (rateMap.get(slot.employeeId) ?? MIN_WAGE_EUR);
        days[idx].cost += cost;
        totals.cost += cost;
      }
      if (slot.overCap) {
        days[idx].overCap++;
        totals.overCap++;
      }
    }
    for (const d of days) d.cost = Math.round(d.cost * 100) / 100;
    totals.cost = Math.round(totals.cost * 100) / 100;

    // ArbZG compliance: rest gaps < 11h between an employee's consecutive shifts,
    // and single shifts > 10h (daily maximum). Surfaced as manager warnings.
    const REST_MIN_H = 11;
    const DAILY_MAX_H = 10;
    const byEmp = new Map<number, { name: string; slots: { start: string; end: string; hours: number }[] }>();
    for (const s of slots) {
      if (s.employeeId === null) continue;
      const e = byEmp.get(s.employeeId) ?? { name: s.employeeName, slots: [] };
      e.slots.push({ start: s.start, end: s.end, hours: s.hours });
      byEmp.set(s.employeeId, e);
    }
    const warnings: { employee: string; kind: 'rest' | 'long'; detail: string }[] = [];
    byEmp.forEach(e => {
      const sorted = e.slots.slice().sort((a, b) => odooToDate(a.start).getTime() - odooToDate(b.start).getTime());
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = (odooToDate(sorted[i + 1].start).getTime() - odooToDate(sorted[i].end).getTime()) / 3_600_000;
        if (gap >= 0 && gap < REST_MIN_H) {
          warnings.push({ employee: e.name, kind: 'rest', detail: `${Math.round(gap)}h rest between shifts (min ${REST_MIN_H}h)` });
        }
      }
      for (const sl of sorted) {
        if (sl.hours > DAILY_MAX_H) {
          warnings.push({ employee: e.name, kind: 'long', detail: `${sl.hours}h shift (max ${DAILY_MAX_H}h)` });
        }
      }
    });

    const confirmedSet = confirmedSlotIds(companyId);
    let assignedPublished = 0;
    let confirmedCount = 0;
    for (const s of slots) {
      if (s.resourceId !== null && s.state === 'published') {
        assignedPublished += 1;
        if (confirmedSet.has(s.id)) confirmedCount += 1;
      }
    }
    const confirmations = { confirmed: confirmedCount, total: assignedPublished };

    return NextResponse.json({ weekKey, days, totals, warnings, confirmations });
  } catch (err: unknown) {
    return serverError('GET coverage', err);
  }
}

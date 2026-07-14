/**
 * GET /api/shifts/overview?company_id=&week=
 *
 * Manager oversight: per staff member, hours this week (vs contract) and this
 * month (vs the monthly cap), plus how many weekend shifts they've worked over
 * the last 8 weeks (fairness). Manager only.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, resolveWeekKey, round2, serverError } from '../_manager';
import { fetchEmployees, monthHoursMap, weekHoursMap } from '@/lib/shifts-odoo';
import { weekendWorkedByEmployee } from '@/lib/shifts-db';
import { berlinParts, nowOdooUtc, offsetWeekKey } from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    const weekKey = resolveWeekKey(searchParams.get('week'));
    if (!weekKey) return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
    const { companyId } = auth;

    const [employees, weekMap, monthMap] = await Promise.all([
      fetchEmployees(companyId),
      weekHoursMap(companyId, weekKey),
      monthHoursMap(companyId),
    ]);

    const WEEKS = 8;
    const periods: string[] = [];
    for (let i = 0; i < WEEKS; i++) periods.push(offsetWeekKey(weekKey, -i));
    const weekendMap = weekendWorkedByEmployee(companyId, periods);

    const employeesOut = employees
      .filter(e => e.resourceId !== null)
      .map(e => ({
        id: e.id,
        name: e.name,
        weekHours: round2(weekMap.get(e.id) ?? 0),
        weeklyTarget: e.weeklyTarget,
        monthHours: round2(monthMap.get(e.id) ?? 0),
        cap: e.cap, // monthly cap
        employmentType: e.employmentType,
        hourlyRate: e.hourlyRate,
        weekendWorked: weekendMap.get(e.id) ?? 0,
      }));

    const weekendAvg = employeesOut.length
      ? Math.round((employeesOut.reduce((s, e) => s + e.weekendWorked, 0) / employeesOut.length) * 10) / 10
      : 0;

    const today = berlinParts(nowOdooUtc()).date;
    const [y, m] = today.split('-').map(Number);
    const monthLabel = `${MONTHS[m - 1]} ${y}`;

    return NextResponse.json({
      weekKey,
      weekendWindowWeeks: WEEKS,
      monthLabel,
      weekendAvg,
      employees: employeesOut,
    });
  } catch (err: unknown) {
    return serverError('GET overview', err);
  }
}

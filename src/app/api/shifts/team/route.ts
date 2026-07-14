/**
 * GET /api/shifts/team?company_id= — manager team-hours KPI.
 *
 * Per-employee scheduled hours this week and this month, each against the
 * person's limit: contracted weekly target for a fixed contract, weekly cap
 * for minijob/hourly, and the €603 Minijob monthly earnings cap. Surfaces
 * over-cap (week) and approaching-/over-cap (Minijob month) risk so a manager
 * sees at a glance who is over-scheduled or near the earnings ceiling.
 *
 * Hours are live from planning.slot (duration = end − start, never allocated).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchEmployees,
  monthHoursMap,
  weekHoursMap,
  MIN_WAGE_EUR,
  MINIJOB_CAP_EUR,
} from '@/lib/shifts-odoo';
import { currentWeekKey } from '@/lib/shifts-time';
import { requireManagerCompany, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const weekKey = currentWeekKey();
    const [employees, weekHours, monthHours] = await Promise.all([
      fetchEmployees(companyId),
      weekHoursMap(companyId, weekKey),
      monthHoursMap(companyId),
    ]);

    const rows = employees
      .map(e => {
        const wk = weekHours.get(e.id) ?? 0;
        const mo = monthHours.get(e.id) ?? 0;
        const rate = e.hourlyRate || MIN_WAGE_EUR;
        const monthEur = round2(mo * rate);
        const capEur = e.employmentType === 'minijob' ? MINIJOB_CAP_EUR : null;
        const weekLimit = e.weeklyTarget && e.weeklyTarget > 0 ? e.weeklyTarget : e.cap;
        const weekKind: 'target' | 'cap' | 'none' =
          e.weeklyTarget && e.weeklyTarget > 0 ? 'target' : e.cap && e.cap > 0 ? 'cap' : 'none';
        return {
          employeeId: e.id,
          name: e.name,
          employmentType: e.employmentType,
          weekHours: wk,
          monthHours: mo,
          weekLimit: weekLimit ?? null,
          weekKind,
          cap: e.cap,
          weeklyTarget: e.weeklyTarget,
          hourlyRate: rate,
          monthEur,
          capEur,
          overCap: e.cap !== null && wk > e.cap + 1e-9,
          nearEurCap: capEur !== null && monthEur >= 0.85 * capEur && monthEur <= capEur,
          overEurCap: capEur !== null && monthEur > capEur,
        };
      })
      // Only people with any scheduled hours are worth a glance.
      .filter(r => r.weekHours > 0 || r.monthHours > 0)
      .sort((a, b) => b.weekHours - a.weekHours || a.name.localeCompare(b.name));

    const totals = {
      people: rows.length,
      weekHours: round2(rows.reduce((s, r) => s + r.weekHours, 0)),
      weekCost: round2(rows.reduce((s, r) => s + r.weekHours * r.hourlyRate, 0)),
      overCap: rows.filter(r => r.overCap).length,
      atEurCap: rows.filter(r => r.overEurCap).length,
    };

    return NextResponse.json({ weekKey, totals, employees: rows });
  } catch (err: unknown) {
    return serverError('GET team', err);
  }
}

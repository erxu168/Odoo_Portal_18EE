/**
 * GET /api/shifts/hours?company_id=
 *
 * Weekly hour totals for the viewer: the last 8 weeks + current + next week.
 * Totals are computed live from planning.slot (duration = end − start, NEVER
 * allocated_hours) and — like employeeWeekHours in the foundation layer —
 * span all companies, because the weekly cap belongs to the person.
 * One batched Odoo read covers the whole 10-week range.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import {
  berlinISOWeekKey,
  currentWeekKey,
  durationHours,
  offsetWeekKey,
  weekKeyToUtcRange,
} from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

const PAST_WEEKS = 8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const companyId = parseInt(searchParams.get('company_id') || '', 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  }
  if (user.role !== 'admin' && !parseCompanyIds(user.allowed_company_ids).includes(companyId)) {
    return NextResponse.json({ error: 'You do not have access to this company' }, { status: 403 });
  }
  if (user.employee_id === null) {
    return NextResponse.json(
      { error: 'Your account is not linked to an employee record' },
      { status: 400 },
    );
  }
  const employeeId = user.employee_id;

  try {
    const current = currentWeekKey();
    // Next week first, then current, then the past 8 — newest to oldest.
    const weekKeys: string[] = [offsetWeekKey(current, 1), current];
    for (let i = 1; i <= PAST_WEEKS; i++) weekKeys.push(offsetWeekKey(current, -i));

    const rangeStart = weekKeyToUtcRange(weekKeys[weekKeys.length - 1]).startOdoo;
    const rangeEnd = weekKeyToUtcRange(weekKeys[0]).endOdoo;

    const odoo = getOdoo();
    const [rows, empRows] = await Promise.all([
      odoo.searchRead(
        'planning.slot',
        [
          ['employee_id', '=', employeeId],
          ['start_datetime', '>=', rangeStart],
          ['start_datetime', '<', rangeEnd],
        ],
        ['start_datetime', 'end_datetime'],
        { limit: 2000 },
      ) as Promise<Record<string, unknown>[]>,
      (odoo.searchRead(
        'hr.employee',
        [['id', '=', employeeId]],
        ['x_max_weekly_hours'],
        { limit: 1 },
        // custom cap field may be absent (addon not installed) → no cap, don't 500
      ) as Promise<Record<string, unknown>[]>).catch(() => [] as Record<string, unknown>[]),
    ]);

    const capRaw = empRows.length > 0 && typeof empRows[0].x_max_weekly_hours === 'number'
      ? empRows[0].x_max_weekly_hours
      : 0;
    const cap = capRaw > 0 ? capRaw : null;

    const totals = new Map<string, number>();
    for (const row of rows) {
      const start = typeof row.start_datetime === 'string' ? row.start_datetime : '';
      const end = typeof row.end_datetime === 'string' ? row.end_datetime : '';
      if (!start || !end) continue;
      const key = berlinISOWeekKey(start);
      totals.set(key, (totals.get(key) ?? 0) + durationHours(start, end));
    }

    const weeks = weekKeys.map(weekKey => {
      const hours = round2(totals.get(weekKey) ?? 0);
      return {
        weekKey,
        hours,
        cap,
        over: cap !== null && hours > cap + 1e-9,
      };
    });

    return NextResponse.json({ weeks });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] hours failed: ${msg}`);
    return NextResponse.json({ error: 'Could not load your hours' }, { status: 500 });
  }
}

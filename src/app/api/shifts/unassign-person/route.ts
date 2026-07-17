/**
 * POST /api/shifts/unassign-person {company_id, employee_id, scope, week?, notify?, dry_run?}
 *
 * Remove one employee from all their assigned shifts in a scope:
 *   scope 'week'     — the given (or current) week only.
 *   scope 'upcoming' — every assigned shift from now on (draft + published),
 *                      across all future weeks.
 * The shifts become OPEN (unfilled), not deleted. dry_run:true returns
 * { count, weeks } to drive the confirm sheet. Side-effects live in _unassign.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchEmployeeUpcomingAssignedSlots, fetchWeekSlots } from '@/lib/shifts-odoo';
import { berlinISOWeekKey } from '@/lib/shifts-time';
import type { ShiftSlot } from '@/types/shifts';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';
import { unassignSlots } from '../_unassign';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const employeeId =
      typeof body.employee_id === 'number' ? body.employee_id : parseInt(String(body.employee_id ?? ''), 10);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });
    }
    const scope = body.scope === 'upcoming' ? 'upcoming' : 'week';
    const notify = body.notify !== false; // default: notify the removed person
    const dryRun = body.dry_run === true;

    let slots: ShiftSlot[];
    if (scope === 'upcoming') {
      slots = await fetchEmployeeUpcomingAssignedSlots(companyId, employeeId);
    } else {
      const weekKey = resolveWeekKey(body.week);
      if (!weekKey) {
        return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
      }
      slots = (await fetchWeekSlots(companyId, weekKey)).filter(s => s.employeeId === employeeId);
    }

    if (dryRun) {
      const weeks = new Set(slots.map(s => berlinISOWeekKey(s.start)));
      return NextResponse.json({ count: slots.length, weeks: weeks.size });
    }

    const result = await unassignSlots(companyId, slots, notify);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    return serverError('POST unassign-person', err);
  }
}

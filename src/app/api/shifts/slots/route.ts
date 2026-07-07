/**
 * POST /api/shifts/slots — manager creates draft shifts.
 *
 * Body: {company_id, date, start, end, role_id?, count?:1, assign_employee_id?,
 * note?, copy_days?:string[]}. Creates `count` draft slots per selected day
 * (the main date + copy_days). Direct assignment never blocks on over-cap —
 * the UI shows the overage warning; the flags are recomputed here after
 * creation for every affected week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createSlot, fetchEmployees, recomputeWeekFlags } from '@/lib/shifts-odoo';
import { setSlotDepartments } from '@/lib/shifts-db';
import { berlinDateTimeToUtcOdoo, berlinISOWeekKey } from '@/lib/shifts-time';
import { isValidDateStr, normalizeHHMM, requireManagerCompany, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

const MAX_COUNT = 20;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    if (!isValidDateStr(body.date)) {
      return NextResponse.json({ error: 'A valid date is required' }, { status: 400 });
    }
    const date = body.date;
    const startHHMM = normalizeHHMM(body.start);
    const endHHMM = normalizeHHMM(body.end);
    if (!startHHMM || !endHHMM) {
      return NextResponse.json({ error: 'Valid start and end times are required' }, { status: 400 });
    }
    if (startHHMM === endHHMM) {
      return NextResponse.json({ error: 'The shift must be longer than zero hours' }, { status: 400 });
    }
    const roleId = typeof body.role_id === 'number' && body.role_id > 0 ? body.role_id : null;
    const departmentId =
      typeof body.department_id === 'number' && body.department_id > 0 ? body.department_id : null;
    const countRaw = body.count === undefined ? 1 : Number(body.count);
    if (!Number.isInteger(countRaw) || countRaw < 1 || countRaw > MAX_COUNT) {
      return NextResponse.json({ error: `count must be between 1 and ${MAX_COUNT}` }, { status: 400 });
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';

    const copyDays = Array.isArray(body.copy_days)
      ? Array.from(new Set(body.copy_days.filter(isValidDateStr))).filter(d => d !== date)
      : [];
    const days = [date, ...copyDays];

    // Resolve the assignee's resource (assignment is via resource_id).
    let resourceId: number | null = null;
    let assignEmployeeId: number | null = null;
    if (body.assign_employee_id !== undefined && body.assign_employee_id !== null) {
      if (typeof body.assign_employee_id !== 'number') {
        return NextResponse.json({ error: 'assign_employee_id must be a number' }, { status: 400 });
      }
      const employees = await fetchEmployees(companyId);
      const employee = employees.find(e => e.id === body.assign_employee_id);
      if (!employee) {
        return NextResponse.json({ error: 'Employee not found in this company' }, { status: 404 });
      }
      if (employee.resourceId === null) {
        return NextResponse.json(
          { error: 'This person cannot be scheduled for shifts.' },
          { status: 400 },
        );
      }
      resourceId = employee.resourceId;
      assignEmployeeId = employee.id;
    }

    const created: number[] = [];
    for (const day of days) {
      for (let i = 0; i < countRaw; i++) {
        created.push(
          await createSlot({ companyId, date: day, startHHMM, endHHMM, roleId, resourceId, note }),
        );
      }
    }

    // Persist the manager's chosen department (portal-side; the Odoo field is
    // readonly). Applies to open and assigned shifts alike.
    if (departmentId !== null) {
      setSlotDepartments(companyId, created, departmentId);
    }

    // Direct-assigned drafts count toward week hours → recompute flags per week.
    if (assignEmployeeId !== null) {
      const weeks = Array.from(
        new Set(days.map(d => berlinISOWeekKey(berlinDateTimeToUtcOdoo(d, startHHMM)))),
      );
      for (const week of weeks) {
        await recomputeWeekFlags(companyId, week, [assignEmployeeId]);
      }
    }

    return NextResponse.json({ ok: true, created });
  } catch (err: unknown) {
    return serverError('POST slots', err);
  }
}

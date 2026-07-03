/**
 * PUT /api/shifts/roster/[employeeId] — manager edits cap, skill and roles.
 *
 * Body: {company_id, cap?:number|null, skill?:'1'|'2'|'3'|null, role_ids?:number[]}.
 * cap → hr.employee.x_max_weekly_hours (null → 0 = no cap);
 * skill → hr.employee.x_skill_level (null → false);
 * role_ids → resource.resource.role_ids via [[6, 0, ids]].
 * A cap change recomputes x_over_cap_flag for the current AND next week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { fetchEmployees, recomputeWeekFlags } from '@/lib/shifts-odoo';
import { currentWeekKey, offsetWeekKey } from '@/lib/shifts-time';
import { requireManagerCompany, serverError } from '../../_manager';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { employeeId: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const employeeId = parseInt(params.employeeId, 10);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });
    }
    const employees = await fetchEmployees(companyId);
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found in this company' }, { status: 404 });
    }

    const employeeVals: Record<string, unknown> = {};
    let capChanged = false;

    if ('cap' in body) {
      if (body.cap === null) {
        employeeVals.x_max_weekly_hours = 0; // 0 = no cap
      } else if (typeof body.cap === 'number' && Number.isFinite(body.cap) && body.cap >= 0 && body.cap <= 168) {
        employeeVals.x_max_weekly_hours = body.cap;
      } else {
        return NextResponse.json({ error: 'cap must be null or a number of hours (0–168)' }, { status: 400 });
      }
      capChanged = true;
    }

    if ('skill' in body) {
      if (body.skill === null) {
        employeeVals.x_skill_level = false;
      } else if (body.skill === '1' || body.skill === '2' || body.skill === '3') {
        employeeVals.x_skill_level = body.skill;
      } else {
        return NextResponse.json(
          { error: 'skill must be null, "1" (Trainee), "2" (Associate) or "3" (Team Lead)' },
          { status: 400 },
        );
      }
    }

    let roleIds: number[] | null = null;
    if ('role_ids' in body) {
      if (!Array.isArray(body.role_ids) || !body.role_ids.every(r => typeof r === 'number' && Number.isInteger(r) && r > 0)) {
        return NextResponse.json({ error: 'role_ids must be an array of role ids' }, { status: 400 });
      }
      if (employee.resourceId === null) {
        return NextResponse.json(
          { error: 'This person cannot be scheduled for shifts, so roles cannot be set.' },
          { status: 400 },
        );
      }
      roleIds = Array.from(new Set(body.role_ids as number[]));
    }

    const odoo = getOdoo();
    if (Object.keys(employeeVals).length > 0) {
      await odoo.write('hr.employee', [employeeId], employeeVals);
    }
    if (roleIds !== null && employee.resourceId !== null) {
      await odoo.write('resource.resource', [employee.resourceId], { role_ids: [[6, 0, roleIds]] });
    }

    // Cap changes alter who is over cap — recompute current + next week.
    if (capChanged) {
      const thisWeek = currentWeekKey();
      await recomputeWeekFlags(companyId, thisWeek, [employeeId]);
      await recomputeWeekFlags(companyId, offsetWeekKey(thisWeek, 1), [employeeId]);
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('PUT roster/[employeeId]', err);
  }
}

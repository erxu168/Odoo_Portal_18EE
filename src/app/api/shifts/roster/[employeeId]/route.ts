/**
 * PUT /api/shifts/roster/[employeeId] — manager edits cap, skill and roles.
 *
 * Body: {company_id, cap?, skill?, department_id?:number|null, role_ids?, ...}.
 * cap → hr.employee.x_max_weekly_hours (null → 0 = no cap);
 * skill → hr.employee.x_skill_level (null → false);
 * department_id → hr.employee.department_id (standard field; null → false);
 * role_ids → resource.resource.role_ids via [[6, 0, ids]].
 * A cap change recomputes x_over_cap_flag for the current AND next week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { setKioskPin } from '@/lib/shifts-db';
import { fetchEmployees, recomputeWeekFlags } from '@/lib/shifts-odoo';
import { currentWeekKey, offsetWeekKey } from '@/lib/shifts-time';
import { requireManagerCompany, serverError } from '../../_manager';
import { isPromotion } from '@/lib/staffing-logic';

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

    // Skill is written SEPARATELY (below) so we can tell whether the change
    // actually persisted — a promotion checklist must never be offered for a
    // level change that silently failed.
    let skillVal: false | '1' | '2' | '3' | undefined;
    let toLevel: string | null | undefined;
    if ('skill' in body) {
      if (body.skill === null) {
        skillVal = false; toLevel = null;
      } else if (body.skill === '1' || body.skill === '2' || body.skill === '3') {
        skillVal = body.skill; toLevel = body.skill;
      } else {
        return NextResponse.json(
          { error: 'skill must be null, "1", "2" or "3"' },
          { status: 400 },
        );
      }
    }

    if ('employment_type' in body) {
      const et = body.employment_type;
      if (et === null) {
        employeeVals.x_employment_type = false;
      } else if (et === 'minijob' || et === 'midijob' || et === 'fulltime') {
        employeeVals.x_employment_type = et;
      } else {
        return NextResponse.json(
          { error: 'employment_type must be null, "minijob", "midijob" or "fulltime"' },
          { status: 400 },
        );
      }
    }

    // department_id is a STANDARD hr.employee field (writable) — validate here and
    // write it separately below so it isn't lost if the addon-only fields fail.
    let departmentWrite: number | false | undefined;
    if ('department_id' in body) {
      const dep = body.department_id;
      if (dep === null) {
        departmentWrite = false;
      } else if (typeof dep === 'number' && Number.isInteger(dep) && dep > 0) {
        departmentWrite = dep;
      } else {
        return NextResponse.json({ error: 'department_id must be null or a department id' }, { status: 400 });
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

    if ('pin' in body) {
      const pin = body.pin;
      if (pin === null || pin === '') {
        setKioskPin(companyId, employeeId, null);
      } else if (typeof pin === 'string' && /^\d{4}$/.test(pin)) {
        setKioskPin(companyId, employeeId, pin);
      } else {
        return NextResponse.json({ error: 'PIN must be 4 digits, or empty to clear' }, { status: 400 });
      }
    }

    const odoo = getOdoo();
    if (Object.keys(employeeVals).length > 0) {
      try {
        await odoo.write('hr.employee', [employeeId], employeeVals);
      } catch {
        // The cap/employment fields require the krawings_shift_selfservice
        // addon. Where it's absent (e.g. production before the addon update), skip
        // this write so roles + PIN still save instead of failing the whole request.
      }
    }

    // Standard field — write on its own so an addon-field failure above doesn't drop it.
    if (departmentWrite !== undefined) {
      await odoo.write('hr.employee', [employeeId], { department_id: departmentWrite });
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

    // Skill write LAST, so a promotion detected here can't be lost by a later
    // dept/role/recompute failure. On a confirmed upward level change we return a
    // promotion_offer for the UI. (x_skill_level needs the shift-selfservice addon;
    // where it's absent the write throws → no offer, matching the tolerant behaviour.)
    let promotionOffer: { employee_id: number; target_level: string; from_level: string | null } | null = null;
    if (skillVal !== undefined) {
      let skillWriteOk = false;
      try {
        // odoo.write returns true on success; treat a non-true result as not-persisted.
        skillWriteOk = (await odoo.write('hr.employee', [employeeId], { x_skill_level: skillVal })) === true;
      } catch { /* addon absent — skill not persisted, so no promotion offer */ }
      if (skillWriteOk && toLevel && isPromotion(employee.skill, toLevel)) {
        promotionOffer = { employee_id: employeeId, target_level: toLevel, from_level: employee.skill };
      }
    }

    return NextResponse.json({ ok: true, promotion_offer: promotionOffer });
  } catch (err: unknown) {
    return serverError('PUT roster/[employeeId]', err);
  }
}

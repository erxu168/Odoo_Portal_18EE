/**
 * GET /api/shifts/open?company_id=
 *
 * Open shifts for staff to claim: published, unassigned, in the future,
 * company-scoped. Every open shift is returned with an `eligible` flag
 * (role-eligible shifts sort first). Also returns the viewer's live current
 * week hours and cap so the claim sheet can project.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { employeeWeekHours, fetchDepartments, fetchEmployees, fetchWeekSlots, meetsMinSkill } from '@/lib/shifts-odoo';
import {
  getWeekendEnabled,
  slotDepartments,
  slotMinSkills,
  upsertWeekendHistory,
  weekendGateUnlockedAt,
} from '@/lib/shifts-db';
import { berlinISOWeekKey, berlinParts, currentWeekKey, durationHours, nowOdooUtc } from '@/lib/shifts-time';
import { computeWeekendGate, isWeekendDow } from '@/lib/shifts-weekend';
import type { CohortEmp, WeekendSlotLite } from '@/lib/shifts-weekend';
import type { ShiftSlot } from '@/types/shifts';

export const dynamic = 'force-dynamic';

type OdooRow = Record<string, unknown>;

function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}

function m2oName(v: unknown): string {
  return Array.isArray(v) && typeof v[1] === 'string' ? v[1] : '';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Same mapping semantics as the shifts-odoo layer (open slots: resource false). */
function mapSlot(row: OdooRow): ShiftSlot {
  const start = str(row.start_datetime);
  const end = str(row.end_datetime);
  return {
    id: row.id as number,
    start,
    end,
    state: row.state === 'published' ? 'published' : 'draft',
    roleId: m2oId(row.role_id),
    roleName: m2oName(row.role_id),
    resourceId: m2oId(row.resource_id),
    employeeId: m2oId(row.employee_id),
    employeeName: m2oName(row.employee_id),
    departmentId: m2oId(row.department_id),
    departmentName: m2oName(row.department_id),
    note: str(row.name),
    overCap: row.x_over_cap_flag === true,
    hours: start && end ? durationHours(start, end) : 0,
    companyId: m2oId(row.company_id) ?? 0,
  };
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
    const [rows, employees, weekHours] = await Promise.all([
      getOdoo().searchRead(
        'planning.slot',
        [
          ['company_id', '=', companyId],
          ['state', '=', 'published'],
          ['resource_id', '=', false],
          ['start_datetime', '>', nowOdooUtc()],
        ],
        [
          'start_datetime',
          'end_datetime',
          'state',
          'role_id',
          'resource_id',
          'employee_id',
          'department_id',
          'name',
          'company_id',
          'x_over_cap_flag',
        ],
        { limit: 500, order: 'start_datetime asc, id asc' },
      ) as Promise<OdooRow[]>,
      fetchEmployees(companyId),
      employeeWeekHours(employeeId, currentWeekKey()),
    ]);

    const me = employees.find(e => e.id === employeeId);
    const canWork = (roleId: number | null): boolean => {
      if (!me || me.resourceId === null) return false;
      return roleId === null || me.roleIds.includes(roleId);
    };

    const mapped = rows.map(mapSlot);
    const slotIds = mapped.map(s => s.id);
    const minSkillMap = slotMinSkills(companyId, slotIds);
    // Overlay the portal department (Odoo's field is empty for open shifts).
    const deptMap = slotDepartments(companyId, slotIds);
    const deptNameById = new Map((await fetchDepartments(companyId)).map(d => [d.id, d.name]));
    const shifts = mapped.map(slot => {
      const minSkill = minSkillMap.get(slot.id) ?? null;
      const deptOv = deptMap.get(slot.id);
      const departmentName = deptOv !== undefined ? deptNameById.get(deptOv) ?? '' : slot.departmentName;
      const roleOk = canWork(slot.roleId);
      const skillOk = meetsMinSkill(me?.skill ?? null, minSkill);
      const reason = (!roleOk ? 'role' : !skillOk ? 'skill' : null) as
        | 'role'
        | 'skill'
        | 'weekend_first'
        | null;
      return { ...slot, departmentName, minSkill, eligible: roleOk && skillOk, reason };
    });

    // Weekend rule: each week's weekday slots are gated behind the viewer's
    // weekend quota for that week. Weekend (Fri/Sat/Sun) slots are never gated —
    // they are the way to satisfy the requirement.
    let weekendGate:
      | { weekKey: string; required: number; remaining: number; weekendSlotsAvailable: number }
      | null = null;
    if (me && me.resourceId !== null && getWeekendEnabled(companyId)) {
      const cohort: CohortEmp[] = employees.map(e => ({
        id: e.id,
        resourceId: e.resourceId,
        skill: e.skill,
        roleIds: e.roleIds,
      }));
      const meCohort: CohortEmp = { id: me.id, resourceId: me.resourceId, skill: me.skill, roleIds: me.roleIds };
      const weeks = Array.from(new Set(shifts.map(s => berlinISOWeekKey(s.start))));
      const gateOpenByWeek = new Map<string, boolean>();
      for (const wk of weeks) {
        const weekSlots = await fetchWeekSlots(companyId, wk);
        const weekendSlots = weekSlots.filter(
          s => s.state === 'published' && isWeekendDow(berlinParts(s.start).dow),
        );
        const wsMinSkill = slotMinSkills(companyId, weekendSlots.map(s => s.id));
        const lite: WeekendSlotLite[] = weekendSlots.map(s => ({
          id: s.id,
          roleId: s.roleId,
          minSkill: (wsMinSkill.get(s.id) as '2' | '3' | undefined) ?? null,
          resourceId: s.resourceId,
        }));
        const gate = computeWeekendGate(lite, cohort, meCohort);
        const grandfathered = weekendGateUnlockedAt(companyId, employeeId, wk) !== null;
        const open = gate.gateOpen || grandfathered;
        gateOpenByWeek.set(wk, open);
        upsertWeekendHistory({
          companyId,
          employeeId,
          periodKey: wk,
          quotaRequired: gate.required,
          weekendWorked: gate.done,
          gateUnlocked: gate.inCohort && gate.remaining === 0,
        });
        if (!open && gate.remaining > 0 && (!weekendGate || wk < weekendGate.weekKey)) {
          weekendGate = {
            weekKey: wk,
            required: gate.required,
            remaining: gate.remaining,
            weekendSlotsAvailable: gate.weekendSlotsAvailable,
          };
        }
      }
      for (const s of shifts) {
        if (!s.eligible) continue;
        if (isWeekendDow(berlinParts(s.start).dow)) continue;
        if (gateOpenByWeek.get(berlinISOWeekKey(s.start)) === false) {
          s.eligible = false;
          s.reason = 'weekend_first';
        }
      }
    }

    // Eligible first, then by start (rows are already start-ordered).
    shifts.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.start.localeCompare(b.start));

    return NextResponse.json({
      shifts,
      weekHours,
      cap: me?.cap ?? me?.weeklyTarget ?? null,
      weekendGate,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] open shifts failed: ${msg}`);
    return NextResponse.json({ error: 'Could not load open shifts' }, { status: 500 });
  }
}

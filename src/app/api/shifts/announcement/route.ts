/**
 * GET /api/shifts/announcement?company_id=
 *
 * Staff-facing: is there an open selection window the viewer still needs to act
 * on? Powers the "what you need to do" pop-up. Returns the active publish run
 * (deadline not passed) plus the viewer's pending actions for that week —
 * remaining weekend quota and how many open shifts they can still pick.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { fetchEmployees, fetchWeekSlots, meetsMinSkill, onLeaveEmployeeIds } from '@/lib/shifts-odoo';
import {
  getWeekendEnabled,
  listPublishRuns,
  slotMinSkills,
  weekendGateUnlockedAt,
} from '@/lib/shifts-db';
import { effectivePublishState } from '@/lib/shifts-patterns';
import { computeWeekendGate, isWeekendDow } from '@/lib/shifts-weekend';
import type { CohortEmp, WeekendSlotLite } from '@/lib/shifts-weekend';
import { berlinParts, odooToDate, weekKeyDays } from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

const HIDDEN = { show: false as const };

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
  const employeeId = user.employee_id;
  if (employeeId === null) return NextResponse.json(HIDDEN);

  try {
    const now = new Date().toISOString();
    const openRun = listPublishRuns(companyId).find(
      r => effectivePublishState(r.state, r.selectDeadline, now) === 'open',
    );
    if (!openRun) return NextResponse.json(HIDDEN);

    const [employees, weekSlots] = await Promise.all([
      fetchEmployees(companyId),
      fetchWeekSlots(companyId, openRun.weekKey),
    ]);
    const me = employees.find(e => e.id === employeeId);
    if (!me || me.resourceId === null) return NextResponse.json(HIDDEN);

    const published = weekSlots.filter(s => s.state === 'published');

    // Weekend quota still owed for this week.
    let weekendRequired = 0;
    let weekendRemaining = 0;
    if (getWeekendEnabled(companyId)) {
      const weekendSlots = published.filter(s => isWeekendDow(berlinParts(s.start).dow));
      const wsMin = slotMinSkills(companyId, weekendSlots.map(s => s.id));
      const lite: WeekendSlotLite[] = weekendSlots.map(s => ({
        id: s.id,
        roleId: s.roleId,
        minSkill: (wsMin.get(s.id) as '2' | '3' | undefined) ?? null,
        resourceId: s.resourceId,
      }));
      const cohort: CohortEmp[] = employees.map(e => ({
        id: e.id,
        resourceId: e.resourceId,
        skill: e.skill,
        roleIds: e.roleIds,
      }));
      // Anyone on approved leave this weekend is out of the cohort.
      const wkDays = weekKeyDays(openRun.weekKey);
      const onLeave = await onLeaveEmployeeIds(cohort.map(e => e.id), wkDays[4], wkDays[6]);
      const availCohort = onLeave.size ? cohort.filter(e => !onLeave.has(e.id)) : cohort;
      const gate = computeWeekendGate(lite, availCohort, {
        id: me.id,
        resourceId: me.resourceId,
        skill: me.skill,
        roleIds: me.roleIds,
      });
      const grandfathered = weekendGateUnlockedAt(companyId, employeeId, openRun.weekKey) !== null;
      weekendRequired = gate.required;
      weekendRemaining = grandfathered ? 0 : gate.remaining;
    }

    // Open shifts in this week the viewer is eligible for (role + skill).
    const nowMs = Date.now();
    const openSlots = published.filter(s => s.resourceId === null && odooToDate(s.start).getTime() > nowMs);
    const openMin = slotMinSkills(companyId, openSlots.map(s => s.id));
    const openEligible = openSlots.filter(
      s =>
        (s.roleId === null || me.roleIds.includes(s.roleId)) &&
        meetsMinSkill(me.skill, openMin.get(s.id) ?? null),
    ).length;

    const show = weekendRemaining > 0 || openEligible > 0;
    return NextResponse.json({
      show,
      runId: openRun.id,
      weekKey: openRun.weekKey,
      deadline: openRun.selectDeadline,
      weekendRequired,
      weekendRemaining,
      openEligible,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] announcement failed: ${msg}`);
    return NextResponse.json(HIDDEN);
  }
}

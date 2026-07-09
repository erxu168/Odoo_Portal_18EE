/**
 * POST /api/shifts/claim  { company_id, slot_id, confirm?: boolean }
 *
 * Staff claims an open shift. The slot is revalidated LIVE inside the
 * mutation: published, unassigned, in the future, role-eligible. When the
 * projected week total exceeds the claimer's cap and confirm !== true the
 * route returns a needsConfirm payload instead of writing; a confirmed
 * over-cap claim notifies the managers. 409 when someone already took it.
 * After the write: recomputeWeekFlags for the claimer's week.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { notifyManagers } from '@/lib/shifts-notify';
import {
  employeeMonthHours,
  employeeWeekHours,
  fetchEmployees,
  fetchSlot,
  fetchWeekSlots,
  meetsMinSkill,
  onLeaveEmployeeIds,
  recomputeWeekFlags,
  updateSlot,
} from '@/lib/shifts-odoo';
import {
  getWeekendEnabled,
  slotMinSkill,
  slotMinSkills,
  upsertWeekendHistory,
  weekendGateUnlockedAt,
} from '@/lib/shifts-db';
import { berlinISOWeekKey, berlinParts, fmtDay, fmtTimeRange, odooToDate, weekKeyDays } from '@/lib/shifts-time';
import { computeWeekendGate, isWeekendDow } from '@/lib/shifts-weekend';
import type { CohortEmp, WeekendSlotLite } from '@/lib/shifts-weekend';

export const dynamic = 'force-dynamic';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { company_id?: unknown; slot_id?: unknown; confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const companyId = typeof body.company_id === 'number' ? body.company_id : parseInt(String(body.company_id ?? ''), 10);
  const slotId = typeof body.slot_id === 'number' ? body.slot_id : parseInt(String(body.slot_id ?? ''), 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  }
  if (!Number.isFinite(slotId) || slotId <= 0) {
    return NextResponse.json({ error: 'slot_id is required' }, { status: 400 });
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
    // Live revalidation — never trust the list the client rendered from.
    const slot = await fetchSlot(slotId);
    if (!slot || slot.companyId !== companyId) {
      return NextResponse.json({ error: 'This shift no longer exists' }, { status: 404 });
    }
    if (slot.state !== 'published') {
      return NextResponse.json({ error: 'This shift is not available' }, { status: 409 });
    }
    if (slot.resourceId !== null) {
      return NextResponse.json({ error: 'Someone already took this shift' }, { status: 409 });
    }
    if (odooToDate(slot.start).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This shift has already started' }, { status: 409 });
    }

    const employees = await fetchEmployees(companyId);
    const me = employees.find(e => e.id === employeeId);
    if (!me || me.resourceId === null) {
      return NextResponse.json(
        { error: 'Your account cannot be scheduled for shifts' },
        { status: 400 },
      );
    }
    if (slot.roleId !== null && !me.roleIds.includes(slot.roleId)) {
      return NextResponse.json({ error: 'You cannot work this role' }, { status: 403 });
    }
    // Skill gate: an open shift may require a minimum level to claim.
    const minSkill = slotMinSkill(companyId, slot.id);
    if (!meetsMinSkill(me.skill, minSkill)) {
      const label = minSkill === '3' ? 'Level 3' : 'Level 2';
      return NextResponse.json(
        { error: `This shift needs ${label} or above.` },
        { status: 403 },
      );
    }

    const weekKey = berlinISOWeekKey(slot.start);

    // Weekend rule: block claiming a WEEKDAY shift until this week's weekend
    // quota is met. Weekend shifts themselves are never blocked. Once met, the
    // unlock is persisted (grandfather guard) so it can't be undone by others.
    if (getWeekendEnabled(companyId) && !isWeekendDow(berlinParts(slot.start).dow)) {
      const grandfathered = weekendGateUnlockedAt(companyId, employeeId, weekKey) !== null;
      if (!grandfathered) {
        const weekSlots = await fetchWeekSlots(companyId, weekKey);
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
        const cohort: CohortEmp[] = employees.map(e => ({
          id: e.id,
          resourceId: e.resourceId,
          skill: e.skill,
          roleIds: e.roleIds,
        }));
        // Anyone on approved leave this weekend is out of the cohort — not
        // counted toward the quota, not gated.
        const wkDays = weekKeyDays(weekKey);
        const onLeave = await onLeaveEmployeeIds(cohort.map(e => e.id), wkDays[4], wkDays[6]);
        const availCohort = onLeave.size ? cohort.filter(e => !onLeave.has(e.id)) : cohort;
        const gate = computeWeekendGate(lite, availCohort, {
          id: me.id,
          resourceId: me.resourceId,
          skill: me.skill,
          roleIds: me.roleIds,
        });
        if (gate.inCohort && gate.remaining === 0) {
          upsertWeekendHistory({
            companyId,
            employeeId,
            periodKey: weekKey,
            quotaRequired: gate.required,
            weekendWorked: gate.done,
            gateUnlocked: true,
          });
        }
        if (!gate.gateOpen) {
          return NextResponse.json(
            {
              error: `Claim ${gate.remaining} weekend shift${gate.remaining === 1 ? '' : 's'} first, then you can pick weekday shifts.`,
              weekend_first: true,
              remaining: gate.remaining,
              weekendSlotsAvailable: gate.weekendSlotsAvailable,
            },
            { status: 409 },
          );
        }
      }
    }

    // Hour-limit projection. The manager cap (me.cap) is a MONTHLY limit;
    // otherwise fall back to the contracted WEEKLY hours. Warn only — never block.
    let limit: number | null = null;
    let projected = 0;
    let period: 'month' | 'week' = 'week';
    if (me.cap !== null) {
      period = 'month';
      limit = me.cap;
      const monthCurrent = await employeeMonthHours(employeeId, berlinParts(slot.start).date);
      projected = round2(monthCurrent + slot.hours);
    } else if (me.weeklyTarget !== null) {
      period = 'week';
      limit = me.weeklyTarget;
      const weekCurrent = await employeeWeekHours(employeeId, weekKey);
      projected = round2(weekCurrent + slot.hours);
    }
    const overLimit = limit !== null && projected > limit;
    if (overLimit && body.confirm !== true) {
      return NextResponse.json({
        needsConfirm: true,
        projected,
        cap: limit,
        overage: round2(projected - (limit ?? 0)),
        period,
      });
    }

    await updateSlot(slot.id, { resourceId: me.resourceId });

    // Best-effort race check: if another claim landed after ours, surface it.
    const after = await fetchSlot(slot.id);
    if (after && after.resourceId !== null && after.resourceId !== me.resourceId) {
      return NextResponse.json({ error: 'Someone already took this shift' }, { status: 409 });
    }

    await recomputeWeekFlags(companyId, weekKey, [employeeId]);

    if (overLimit) {
      await notifyManagers(companyId, 'claim_over_cap', {
        day: fmtDay(slot.start),
        time: fmtTimeRange(slot.start, slot.end),
        roleName: slot.roleName,
        slotId: slot.id,
        employeeId,
        employeeName: me.name,
        projected,
        cap: limit,
        overage: round2(projected - (limit ?? 0)),
        message: `${me.name} took this shift over their ${period === 'month' ? 'monthly' : 'weekly'} hours.`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] claim failed: ${msg}`);
    return NextResponse.json({ error: 'Could not claim this shift' }, { status: 500 });
  }
}

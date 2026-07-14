/**
 * POST /api/shifts/copy-last-week {company_id, week} — clone last week's plan.
 *
 * Copies the previous week's slots (Berlin wall-clock times, role, assignee,
 * note) to the same weekday of the target week as DRAFTS. Identical duplicates
 * are skipped count-wise: a target-day slot with the same start/end/role/
 * resource consumes one matching copy (so re-running the copy never doubles
 * the plan). Over-cap flags are recomputed for the target week afterwards.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createSlot, fetchWeekSlots, recomputeWeekFlags } from '@/lib/shifts-odoo';
import {
  setSlotDepartment,
  setSlotMinSkill,
  slotDepartments,
  slotMinSkills,
} from '@/lib/shifts-db';
import { berlinParts, offsetWeekKey, weekKeyDays } from '@/lib/shifts-time';
import type { ShiftSlot } from '@/types/shifts';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

/** Identity of a slot for duplicate matching: day + times + role + resource. */
function slotKey(date: string, startHHMM: string, endHHMM: string, roleId: number | null, resourceId: number | null): string {
  return `${date}|${startHHMM}|${endHHMM}|${roleId ?? 0}|${resourceId ?? 0}`;
}

function keyOfExisting(slot: ShiftSlot): string {
  const start = berlinParts(slot.start);
  const end = berlinParts(slot.end);
  return slotKey(start.date, start.hhmm, end.hhmm, slot.roleId, slot.resourceId);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const weekKey = resolveWeekKey(body.week);
    if (!weekKey) {
      return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
    }
    const prevWeekKey = offsetWeekKey(weekKey, -1);

    const [prevSlots, targetSlots] = await Promise.all([
      fetchWeekSlots(companyId, prevWeekKey),
      fetchWeekSlots(companyId, weekKey),
    ]);
    // Portal overrides on last week's slots — carried onto the copies below.
    const prevDeptOverride = slotDepartments(companyId, prevSlots.map(s => s.id));
    const prevSkillOverride = slotMinSkills(companyId, prevSlots.map(s => s.id));

    // Count identical slots already in the target week; each match consumes one copy.
    const existingCount = new Map<string, number>();
    for (const slot of targetSlots) {
      const key = keyOfExisting(slot);
      existingCount.set(key, (existingCount.get(key) ?? 0) + 1);
    }

    const prevDays = weekKeyDays(prevWeekKey);
    const targetDays = weekKeyDays(weekKey);
    const prevDayIndex = new Map(prevDays.map((d, i) => [d, i]));

    let created = 0;
    let createdAssigned = false;
    for (const slot of prevSlots) {
      const start = berlinParts(slot.start);
      const end = berlinParts(slot.end);
      const dayIdx = prevDayIndex.get(start.date);
      if (dayIdx === undefined) continue;
      const targetDate = targetDays[dayIdx];

      const key = slotKey(targetDate, start.hhmm, end.hhmm, slot.roleId, slot.resourceId);
      const already = existingCount.get(key) ?? 0;
      if (already > 0) {
        existingCount.set(key, already - 1); // identical slot exists — skip this copy
        continue;
      }

      // createSlot re-applies the overnight rule (end <= start → next day).
      const newId = await createSlot({
        companyId,
        date: targetDate,
        startHHMM: start.hhmm,
        endHHMM: end.hhmm,
        roleId: slot.roleId,
        resourceId: slot.resourceId,
        note: slot.note,
      });
      // Carry the portal overrides onto the copy.
      const deptOv = prevDeptOverride.get(slot.id);
      if (deptOv !== undefined) setSlotDepartment(companyId, newId, deptOv);
      const skillOv = prevSkillOverride.get(slot.id);
      if (skillOv !== undefined && slot.resourceId === null) setSlotMinSkill(companyId, newId, skillOv);
      created++;
      if (slot.resourceId !== null) createdAssigned = true;
    }

    // Assigned copies change week hours → recompute the target week's flags.
    if (createdAssigned) {
      await recomputeWeekFlags(companyId, weekKey);
    }

    return NextResponse.json({ ok: true, created });
  } catch (err: unknown) {
    return serverError('POST copy-last-week', err);
  }
}

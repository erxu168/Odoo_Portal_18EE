/**
 * POST /api/shifts/duplicate — duplicate a week's shifts onto later weeks.
 *
 * Body: { company_id, source_week:"YYYY-Www", source_dates:string[],
 *         repeat:"once"|"weekly_until", until?:"YYYY-MM-DD" }.
 * Copies the shifts on the selected source days onto source_date + 7·n as
 * OPEN, unassigned drafts (no assignee, no confirmations, no publish state).
 * Count-aware dedup: a copy that already exists in a target week is skipped, so
 * re-running never double-books. Manager only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createSlot, fetchWeekSlots } from '@/lib/shifts-odoo';
import {
  setSlotDepartment,
  setSlotMinSkill,
  slotDepartments,
  slotMinSkills,
} from '@/lib/shifts-db';
import { berlinISOWeekKey, berlinParts, weekKeyDays } from '@/lib/shifts-time';
import { isValidDateStr, requireManagerCompany, serverError } from '../_manager';
import {
  addDaysISO,
  planDuplicates,
  targetDatesFor,
  type DupSpec,
  type RepeatMode,
} from '@/lib/shifts-duplicate';

export const dynamic = 'force-dynamic';

const MAX_WEEKS = 8; // horizon cap (matches the recurring-shift window)
const MAX_CREATE = 500; // guard against runaway ranges

const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;

/** Reduce an Odoo slot + portal overrides to a duplication spec. */
function toSpec(
  s: { id: number; start: string; end: string; roleId: number | null; departmentId: number | null; note: string },
  deptOv: Map<number, number>,
  skillOv: Map<number, string>,
): DupSpec {
  const p = berlinParts(s.start);
  const pe = berlinParts(s.end);
  return {
    date: p.date,
    start: p.hhmm,
    end: pe.hhmm,
    roleId: s.roleId ?? null,
    deptId: deptOv.get(s.id) ?? s.departmentId ?? null,
    minSkill: skillOv.get(s.id) ?? null,
    note: s.note || '',
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const sourceWeek = typeof body.source_week === 'string' ? body.source_week : '';
    if (!WEEK_KEY_RE.test(sourceWeek)) {
      return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
    }
    const weekDays = weekKeyDays(sourceWeek);

    const sourceDates = Array.isArray(body.source_dates)
      ? Array.from(new Set(body.source_dates.filter(isValidDateStr))).filter(d => weekDays.includes(d))
      : [];
    if (sourceDates.length === 0) {
      return NextResponse.json({ error: 'Pick at least one day to copy' }, { status: 400 });
    }
    // Anchor the horizon on the week end (Sunday), matching the sheet's date picker.
    const weekEnd = weekDays[weekDays.length - 1];

    const mode: RepeatMode = body.repeat === 'weekly_until' ? 'weekly_until' : 'once';
    let until: string | null = null;
    if (mode === 'weekly_until') {
      if (!isValidDateStr(body.until)) {
        return NextResponse.json({ error: 'Choose an end date for the repeat' }, { status: 400 });
      }
      until = body.until as string;
      if (until <= weekEnd) {
        return NextResponse.json({ error: 'The end date must be after the selected week' }, { status: 400 });
      }
      if (until > addDaysISO(weekEnd, MAX_WEEKS * 7)) {
        return NextResponse.json(
          { error: `You can repeat up to ${MAX_WEEKS} weeks ahead — pick a nearer end date.` },
          { status: 400 },
        );
      }
    }

    // Read the source week live (never trust stale client payloads); include
    // draft + published slots.
    const srcSlots = await fetchWeekSlots(companyId, sourceWeek);
    const srcIds = srcSlots.map(s => s.id);
    const srcDeptOv = slotDepartments(companyId, srcIds);
    const srcSkillOv = slotMinSkills(companyId, srcIds);
    const sources: DupSpec[] = srcSlots
      .map(s => toSpec(s, srcDeptOv, srcSkillOv))
      .filter(s => sourceDates.includes(s.date));
    if (sources.length === 0) {
      return NextResponse.json({ error: 'The selected days have no shifts to copy' }, { status: 400 });
    }

    // Which weeks will receive copies → read them once for count-aware dedup.
    const targetDates = new Set<string>();
    for (const s of sources) {
      for (const td of targetDatesFor(s.date, mode, until, MAX_WEEKS)) targetDates.add(td);
    }
    const targetWeeks = Array.from(
      new Set(Array.from(targetDates).map(d => berlinISOWeekKey(`${d} 12:00:00`))),
    );
    const existing: DupSpec[] = [];
    for (const wk of targetWeeks) {
      const ws = await fetchWeekSlots(companyId, wk);
      const wids = ws.map(x => x.id);
      const dov = slotDepartments(companyId, wids);
      const sov = slotMinSkills(companyId, wids);
      for (const x of ws) existing.push(toSpec(x, dov, sov));
    }

    const { toCreate, skipped } = planDuplicates({ sources, existing, mode, until, maxWeeks: MAX_WEEKS });
    if (toCreate.length > MAX_CREATE) {
      return NextResponse.json(
        { error: `That would create ${toCreate.length} shifts — narrow the range (max ${MAX_CREATE}).` },
        { status: 400 },
      );
    }

    // Create each copy as an open draft, then apply portal-side department + skill.
    let created = 0;
    for (const t of toCreate) {
      const id = await createSlot({
        companyId,
        date: t.date,
        startHHMM: t.start,
        endHHMM: t.end,
        roleId: t.roleId,
        resourceId: null,
        note: t.note,
      });
      if (t.deptId !== null) setSlotDepartment(companyId, id, t.deptId);
      if (t.minSkill === '2' || t.minSkill === '3') setSlotMinSkill(companyId, id, t.minSkill);
      created++;
    }

    return NextResponse.json({ ok: true, created, skipped, targetWeeks: targetWeeks.length });
  } catch (err: unknown) {
    return serverError('POST duplicate', err);
  }
}

/**
 * POST /api/shifts/patterns/[id]/publish
 * Body: { company_id, week, select_deadline }.
 *
 * Expands the pattern into open (unassigned) planning.slot records for the given
 * ISO week, applies the manager's per-line department + min-skill overrides,
 * publishes them all in one write, and records a publish run carrying the
 * staff-selection deadline. Manager only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { createSlot, fetchEmployees } from '@/lib/shifts-odoo';
import {
  createPublishRun,
  getPattern,
  recordPublishSlots,
  setSlotDepartments,
  setSlotMinSkills,
} from '@/lib/shifts-db';
import { notifyEmployee } from '@/lib/shifts-notify';
import { planSlotsForWeek } from '@/lib/shifts-patterns';
import { weekKeyDays } from '@/lib/shifts-time';
import { requireManagerCompany, resolveWeekKey, serverError } from '../../../_manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const patternId = parseInt(params.id, 10);
    if (!Number.isInteger(patternId) || patternId <= 0) {
      return NextResponse.json({ error: 'Invalid pattern id' }, { status: 400 });
    }
    const pattern = getPattern(patternId, companyId);
    if (!pattern) return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });

    const weekKey = resolveWeekKey(body.week);
    if (!weekKey) return NextResponse.json({ error: 'Invalid week' }, { status: 400 });

    const deadlineMs = typeof body.select_deadline === 'string' ? Date.parse(body.select_deadline) : NaN;
    if (!Number.isFinite(deadlineMs)) {
      return NextResponse.json({ error: 'A valid selection deadline is required' }, { status: 400 });
    }
    if (deadlineMs <= Date.now()) {
      return NextResponse.json({ error: 'The deadline must be in the future' }, { status: 400 });
    }
    const selectDeadline = new Date(deadlineMs).toISOString();

    const planned = planSlotsForWeek(pattern.lines, weekKey);
    if (planned.length === 0) {
      return NextResponse.json({ error: 'This pattern has no shifts' }, { status: 400 });
    }

    // Create one open (unassigned) draft slot per planned slot, tracking each
    // slot's department + min-skill so we can apply the portal-side overrides.
    const created: number[] = [];
    const deptOf = new Map<number, number>();
    const skillOf = new Map<number, '2' | '3'>();
    for (const p of planned) {
      const slotId = await createSlot({
        companyId,
        date: p.date,
        startHHMM: p.startHHMM,
        endHHMM: p.endHHMM,
        roleId: p.roleId,
        resourceId: null,
        note: '',
      });
      created.push(slotId);
      if (p.departmentId !== null) deptOf.set(slotId, p.departmentId);
      if (p.minSkill !== null) skillOf.set(slotId, p.minSkill);
    }

    // Apply department + min-skill overrides, batched by value.
    const byDept = new Map<number, number[]>();
    for (const [slotId, dept] of Array.from(deptOf.entries())) {
      const list = byDept.get(dept) ?? [];
      list.push(slotId);
      byDept.set(dept, list);
    }
    for (const [dept, ids] of Array.from(byDept.entries())) {
      setSlotDepartments(companyId, ids, dept);
    }
    const bySkill = new Map<'2' | '3', number[]>();
    for (const [slotId, skill] of Array.from(skillOf.entries())) {
      const list = bySkill.get(skill) ?? [];
      list.push(slotId);
      bySkill.set(skill, list);
    }
    for (const [skill, ids] of Array.from(bySkill.entries())) {
      setSlotMinSkills(companyId, ids, skill);
    }

    // Publish everything in one write, then record the run + slot mapping.
    await getOdoo().write('planning.slot', created, { state: 'published' });
    const runId = createPublishRun({ companyId, patternId: pattern.id, weekKey, selectDeadline });
    recordPublishSlots(runId, created);

    // Notify every schedulable staff member: shifts are up to pick. In-app + a
    // best-effort push. Never let a notification failure break the publish.
    try {
      const days = weekKeyDays(weekKey);
      const weekLabel = `${days[0]} to ${days[6]}`;
      const staff = await fetchEmployees(companyId);
      for (const e of staff) {
        if (e.resourceId === null) continue;
        await notifyEmployee(e.id, companyId, 'week_published', {
          weekKey,
          message: `New shifts are up for the week of ${weekLabel}. Open Planning and pick yours before the deadline.`,
        });
      }
    } catch (notifyErr: unknown) {
      const m = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
      console.warn(`[shifts] publish notify failed (ignored): ${m}`);
    }

    return NextResponse.json({ ok: true, runId, created: created.length });
  } catch (err: unknown) {
    return serverError('POST patterns/[id]/publish', err);
  }
}

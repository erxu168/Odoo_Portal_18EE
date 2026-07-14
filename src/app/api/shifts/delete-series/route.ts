/**
 * POST /api/shifts/delete-series {company_id, slot_id, dry_run?}
 *
 * Apple-Calendar-style "delete this and all future occurrences". A shift
 * duplicated across days isn't a real recurrence (each day is its own
 * planning.slot), so a "series" is matched heuristically: same name, role,
 * assignee (or open) and wall-clock start/end times, on the reference day or
 * later. dry_run returns { count } to drive the confirm dialog; otherwise all
 * matches are deleted (portal overrides cleaned, cover requests invalidated,
 * over-cap flags recomputed, affected assignees notified once each).
 *
 * "Just this day" is the existing single DELETE /api/shifts/slots/[id].
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { invalidateActiveRequestsForSlot } from '@/lib/shifts-guards';
import {
  deleteSlotDepartment,
  deleteSlotMinSkill,
  slotDepartments,
  slotMinSkill,
  slotMinSkills,
} from '@/lib/shifts-db';
import { deleteSlot, fetchSlot, recomputeWeekFlags } from '@/lib/shifts-odoo';
import { notifyEmployee } from '@/lib/shifts-notify';
import { berlinISOWeekKey, berlinParts, fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import { requireManagerCompany, serverError } from '../_manager';

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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const slotId = typeof body.slot_id === 'number' ? body.slot_id : parseInt(String(body.slot_id ?? ''), 10);
    if (!Number.isInteger(slotId) || slotId <= 0) {
      return NextResponse.json({ error: 'slot_id is required' }, { status: 400 });
    }
    const dryRun = body.dry_run === true;

    const ref = await fetchSlot(slotId);
    if (!ref || ref.companyId !== companyId) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }

    const refStartHHMM = berlinParts(ref.start).hhmm;
    const refEndHHMM = berlinParts(ref.end).hhmm;

    // Candidates: same name / role / assignee, starting on the reference day or later.
    const rows = (await getOdoo().searchRead(
      'planning.slot',
      [
        ['company_id', '=', companyId],
        ['start_datetime', '>=', ref.start],
        ['role_id', '=', ref.roleId ?? false],
        ['resource_id', '=', ref.resourceId ?? false],
        ['name', '=', ref.note || false],
      ],
      ['start_datetime', 'end_datetime', 'employee_id', 'state', 'role_id'],
      { limit: 1000, order: 'start_datetime asc' },
    )) as OdooRow[];

    // Keep only exact wall-clock time matches (DST-safe)...
    const timeMatches = rows.filter(
      r =>
        berlinParts(str(r.start_datetime)).hhmm === refStartHHMM &&
        berlinParts(str(r.end_datetime)).hhmm === refEndHHMM,
    );
    // ...and the SAME portal department + min-skill as the reference, so two
    // look-alike shifts on different stations/levels are never merged into one
    // "series" (which would wipe both).
    const refDept = slotDepartments(companyId, [ref.id]).get(ref.id) ?? null;
    const refSkill = slotMinSkill(companyId, ref.id);
    const candIds = timeMatches.map(r => r.id as number);
    const deptOv = slotDepartments(companyId, candIds);
    const skillOv = slotMinSkills(companyId, candIds);
    const matches = timeMatches.filter(r => {
      const id = r.id as number;
      return (deptOv.get(id) ?? null) === refDept && (skillOv.get(id) ?? null) === (refSkill ?? null);
    });
    const ids = matches.map(r => r.id as number);
    if (!ids.includes(slotId)) ids.push(slotId);

    if (dryRun) {
      return NextResponse.json({ count: ids.length });
    }
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    // One cancellation notice per distinct published assignee.
    const notifyMap = new Map<number, { count: number; first: OdooRow }>();
    const weeks = new Set<string>();
    const affectedEmp = new Set<number>();
    for (const r of matches) {
      weeks.add(berlinISOWeekKey(str(r.start_datetime)));
      const eid = m2oId(r.employee_id);
      if (eid !== null) affectedEmp.add(eid);
      if (r.state === 'published' && eid !== null) {
        const e = notifyMap.get(eid) ?? { count: 0, first: r };
        e.count += 1;
        notifyMap.set(eid, e);
      }
    }

    for (const id of ids) {
      await invalidateActiveRequestsForSlot(id, 'The shift was deleted.');
      await deleteSlot(id);
      deleteSlotDepartment(id);
      deleteSlotMinSkill(id);
    }

    if (affectedEmp.size > 0) {
      const empIds = Array.from(affectedEmp);
      for (const wk of Array.from(weeks)) {
        await recomputeWeekFlags(companyId, wk, empIds);
      }
    }

    try {
      for (const [employeeId, e] of Array.from(notifyMap.entries())) {
        await notifyEmployee(employeeId, companyId, 'shift_cancelled', {
          day: fmtDay(str(e.first.start_datetime)),
          time: fmtTimeRange(str(e.first.start_datetime), str(e.first.end_datetime)),
          roleName: m2oName(e.first.role_id),
          count: e.count,
          message:
            e.count === 1 ? 'This shift was cancelled.' : `${e.count} of your shifts were cancelled.`,
        });
      }
    } catch (err: unknown) {
      console.warn('[shifts] series-cancel notify failed (ignored):', err instanceof Error ? err.message : String(err));
    }

    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (err: unknown) {
    return serverError('POST delete-series', err);
  }
}

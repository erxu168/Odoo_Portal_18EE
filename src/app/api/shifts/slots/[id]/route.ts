/**
 * PUT    /api/shifts/slots/[id] — manager edits / assigns / unassigns a shift.
 * DELETE /api/shifts/slots/[id]?company_id= — manager deletes a shift.
 *
 * Both call invalidateActiveRequestsForSlot BEFORE changing the slot (any
 * manager edit auto-invalidates pending cover requests + notifies both
 * parties), then recompute x_over_cap_flag for every affected employee and
 * week: old assignee, new assignee, old week, new week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { invalidateActiveRequestsForSlot } from '@/lib/shifts-guards';
import { deleteSlot, fetchEmployees, fetchSlot, recomputeWeekFlags, updateSlot } from '@/lib/shifts-odoo';
import { notifyEmployee } from '@/lib/shifts-notify';
import { berlinISOWeekKey, fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import { isValidDateStr, normalizeHHMM, requireManagerCompany, serverError } from '../../_manager';

export const dynamic = 'force-dynamic';

function parseSlotId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const slotId = parseSlotId(params.id);
    if (slotId === null) {
      return NextResponse.json({ error: 'Invalid shift id' }, { status: 400 });
    }
    const before = await fetchSlot(slotId);
    if (!before || before.companyId !== companyId) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }

    // Build the update payload from the provided fields only.
    const updates: Parameters<typeof updateSlot>[1] = {};
    if (body.date !== undefined) {
      if (!isValidDateStr(body.date)) {
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
      }
      updates.date = body.date;
    }
    if (body.start !== undefined) {
      const hhmm = normalizeHHMM(body.start);
      if (!hhmm) return NextResponse.json({ error: 'Invalid start time' }, { status: 400 });
      updates.startHHMM = hhmm;
    }
    if (body.end !== undefined) {
      const hhmm = normalizeHHMM(body.end);
      if (!hhmm) return NextResponse.json({ error: 'Invalid end time' }, { status: 400 });
      updates.endHHMM = hhmm;
    }
    if ('role_id' in body) {
      updates.roleId = typeof body.role_id === 'number' && body.role_id > 0 ? body.role_id : null;
    }
    if ('note' in body) {
      updates.note = typeof body.note === 'string' ? body.note.trim() : '';
    }

    let newEmployeeId: number | null = null;
    if ('assign_employee_id' in body) {
      if (body.assign_employee_id === null) {
        updates.resourceId = null; // unassign → open shift
      } else if (typeof body.assign_employee_id === 'number') {
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
        updates.resourceId = employee.resourceId;
        newEmployeeId = employee.id;
      } else {
        return NextResponse.json({ error: 'assign_employee_id must be a number or null' }, { status: 400 });
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true }); // nothing to change
    }

    // Invalidate any active cover request BEFORE changing the slot.
    await invalidateActiveRequestsForSlot(slotId, 'The shift was changed by a manager.');

    await updateSlot(slotId, updates);

    // Recompute flags for every affected employee and week (old + new).
    const after = await fetchSlot(slotId);
    const weeks = new Set<string>([berlinISOWeekKey(before.start)]);
    if (after) weeks.add(berlinISOWeekKey(after.start));
    const affected = new Set<number>();
    if (before.employeeId !== null) affected.add(before.employeeId);
    if (newEmployeeId !== null) affected.add(newEmployeeId);
    if (after && after.employeeId !== null) affected.add(after.employeeId);
    if (affected.size > 0) {
      const employeeIds = Array.from(affected);
      for (const week of Array.from(weeks)) {
        await recomputeWeekFlags(companyId, week, employeeIds);
      }
    }

    // Tell affected staff their PUBLISHED shift changed (drafts stay silent —
    // staff can't see them yet). Never let a notify failure fail the edit.
    try {
      if (before.state === 'published') {
        const beforeEmp = before.employeeId;
        const afterEmp = after?.employeeId ?? null;
        const roleName = (after ?? before).roleName || '';
        if (beforeEmp !== null && beforeEmp !== afterEmp) {
          await notifyEmployee(beforeEmp, companyId, 'shift_changed', {
            day: fmtDay(before.start), time: fmtTimeRange(before.start, before.end), roleName,
            message: 'This shift is no longer yours — a manager reassigned it.',
          });
        }
        if (after && afterEmp !== null && afterEmp !== beforeEmp) {
          await notifyEmployee(afterEmp, companyId, 'shift_changed', {
            day: fmtDay(after.start), time: fmtTimeRange(after.start, after.end), roleName,
            message: 'You were added to this shift.',
          });
        }
        const detailsChanged =
          updates.date !== undefined || updates.startHHMM !== undefined ||
          updates.endHHMM !== undefined || updates.roleId !== undefined;
        if (after && afterEmp !== null && afterEmp === beforeEmp && detailsChanged) {
          await notifyEmployee(afterEmp, companyId, 'shift_changed', {
            day: fmtDay(after.start), time: fmtTimeRange(after.start, after.end), roleName,
            message: 'Your shift was updated — check the new time.',
          });
        }
      }
    } catch (err: unknown) {
      console.warn('[shifts] change notify failed (ignored):', err instanceof Error ? err.message : String(err));
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('PUT slots/[id]', err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const slotId = parseSlotId(params.id);
    if (slotId === null) {
      return NextResponse.json({ error: 'Invalid shift id' }, { status: 400 });
    }

    const slot = await fetchSlot(slotId);
    if (!slot) {
      // Already gone — clean up any dangling request and report success.
      await invalidateActiveRequestsForSlot(slotId, 'The shift was deleted.');
      return NextResponse.json({ ok: true });
    }
    if (slot.companyId !== companyId) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }

    // Invalidate any active cover request BEFORE deleting the slot.
    await invalidateActiveRequestsForSlot(slotId, 'The shift was deleted.');

    await deleteSlot(slotId);

    if (slot.employeeId !== null) {
      await recomputeWeekFlags(companyId, berlinISOWeekKey(slot.start), [slot.employeeId]);
    }

    // Tell the assigned staff their PUBLISHED shift was cancelled.
    try {
      if (slot.state === 'published' && slot.employeeId !== null) {
        await notifyEmployee(slot.employeeId, companyId, 'shift_cancelled', {
          day: fmtDay(slot.start), time: fmtTimeRange(slot.start, slot.end), roleName: slot.roleName || '',
          message: 'This shift was cancelled.',
        });
      }
    } catch (err: unknown) {
      console.warn('[shifts] cancel notify failed (ignored):', err instanceof Error ? err.message : String(err));
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('DELETE slots/[id]', err);
  }
}

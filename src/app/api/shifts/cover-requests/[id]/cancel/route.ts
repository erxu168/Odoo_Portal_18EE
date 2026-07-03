/**
 * POST /api/shifts/cover-requests/[id]/cancel  { company_id }
 *
 * Requester withdraws their own cover request. Lazy expiry runs inside the
 * mutation, then CAS from either pending state → cancelled_by_requester.
 * Notifies the target (directed), the acceptor (pending_manager) or all
 * eligible teammates (ask-all). Dropping from the manager queue is implicit —
 * the status is no longer pending_manager.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { casTransition, getCoverRequest, getShiftSettings } from '@/lib/shifts-db';
import { lazyExpireIfDue } from '@/lib/shifts-guards';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fetchEmployees, fetchSlot } from '@/lib/shifts-odoo';
import { fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import type { ShiftSlot, SlotSnapshot } from '@/types/shifts';

export const dynamic = 'force-dynamic';

function slotSummary(slot: ShiftSlot | null, snap: SlotSnapshot) {
  const start = slot?.start || snap.start;
  const end = slot?.end || snap.end;
  return {
    day: start ? fmtDay(start) : '',
    time: start && end ? fmtTimeRange(start, end) : '',
    roleName: slot?.roleName || '',
  };
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { company_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const companyId = typeof body.company_id === 'number' ? body.company_id : parseInt(String(body.company_id ?? ''), 10);
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

  const requestId = parseInt(params.id, 10);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
  }

  try {
    const cover = getCoverRequest(requestId);
    if (!cover || cover.companyId !== companyId) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (cover.fromEmployeeId !== employeeId) {
      return NextResponse.json({ error: 'Only the requester can cancel this' }, { status: 403 });
    }

    // Expiry is enforced inside every mutation (live slot read first).
    const settings = getShiftSettings(companyId);
    const slot = await fetchSlot(cover.slotId);
    const current = lazyExpireIfDue(cover, slot, settings);
    if (current.status === 'expired') {
      return NextResponse.json(
        { error: 'This request has already expired.', code: 'expired' },
        { status: 409 },
      );
    }
    if (current.status !== 'pending_teammate' && current.status !== 'pending_manager') {
      return NextResponse.json(
        { error: 'This request has already been decided.', code: 'not_pending' },
        { status: 409 },
      );
    }

    const swapped = casTransition(
      requestId,
      ['pending_teammate', 'pending_manager'],
      'cancelled_by_requester',
      { decidedByEmployeeId: employeeId },
    );
    if (!swapped) {
      return NextResponse.json(
        { error: 'This request changed while cancelling. Please reload.', code: 'state_changed' },
        { status: 409 },
      );
    }

    const employees = await fetchEmployees(companyId);
    const myName = employees.find(e => e.id === employeeId)?.name || user.name;
    const payload = {
      ...slotSummary(slot, cover.slotSnapshot),
      requestId,
      slotId: cover.slotId,
      fromEmployeeId: employeeId,
      fromName: myName,
      message: `${myName} withdrew the cover request.`,
    };

    // Notify whoever was asked: the acceptor (waiting for manager), the direct
    // target, or every eligible teammate on an ask-all.
    const notified = new Set<number>();
    const notify = async (targetId: number | null) => {
      if (targetId === null || targetId === employeeId || notified.has(targetId)) return;
      notified.add(targetId);
      await notifyEmployee(targetId, companyId, 'cover_cancelled', payload);
    };

    if (current.status === 'pending_manager') {
      await notify(current.acceptedByEmployeeId ?? cover.toEmployeeId);
    } else if (cover.askAll) {
      const roleId = slot ? slot.roleId : cover.slotSnapshot.roleId;
      const recipients = employees.filter(e =>
        e.id !== employeeId &&
        e.resourceId !== null &&
        (roleId === null || e.roleIds.includes(roleId)),
      );
      for (const recipient of recipients) {
        await notify(recipient.id);
      }
    } else {
      await notify(cover.toEmployeeId);
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] cover-request cancel failed: ${msg}`);
    return NextResponse.json({ error: 'Could not cancel this request' }, { status: 500 });
  }
}

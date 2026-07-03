/**
 * POST /api/shifts/cover-requests/[id]/decline  { company_id }
 *
 * Teammate declines a cover request. Lazy expiry runs inside the mutation.
 * Directed request (to_employee_id = me): CAS pending_teammate →
 * declined_by_teammate + notify the requester.
 * Ask-all (v1 simplification per spec): a decline just notifies the requester;
 * the request stays open for everyone else until the deadline.
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

    // Expiry is enforced inside every mutation (live slot read first).
    const settings = getShiftSettings(companyId);
    const slot = await fetchSlot(cover.slotId);
    const current = lazyExpireIfDue(cover, slot, settings);
    if (current.status === 'expired') {
      return NextResponse.json(
        { error: 'This request has expired.', code: 'expired' },
        { status: 409 },
      );
    }
    if (current.status !== 'pending_teammate') {
      return NextResponse.json(
        { error: 'This request is no longer open.', code: 'not_pending' },
        { status: 409 },
      );
    }

    const employees = await fetchEmployees(companyId);
    const myName = employees.find(e => e.id === employeeId)?.name || user.name;
    const payload = {
      ...slotSummary(slot, cover.slotSnapshot),
      requestId,
      slotId: cover.slotId,
      fromEmployeeId: cover.fromEmployeeId,
      toEmployeeId: employeeId,
      declinedByName: myName,
    };

    if (cover.toEmployeeId !== null) {
      // Directed request: only the target may decline; the request closes.
      if (cover.toEmployeeId !== employeeId) {
        return NextResponse.json({ error: 'This request was sent to someone else' }, { status: 403 });
      }
      const swapped = casTransition(requestId, 'pending_teammate', 'declined_by_teammate', {
        decidedByEmployeeId: employeeId,
      });
      if (!swapped) {
        return NextResponse.json(
          { error: 'This request changed while declining. Please reload.', code: 'state_changed' },
          { status: 409 },
        );
      }
      await notifyEmployee(cover.fromEmployeeId, companyId, 'cover_declined_by_teammate', {
        ...payload,
        message: `${myName} cannot cover this shift.`,
      });
      return NextResponse.json({ ok: true });
    }

    // Ask-all (v1 simplification): notify the requester; the request stays
    // open for everyone else until the deadline.
    if (!cover.askAll || cover.fromEmployeeId === employeeId) {
      return NextResponse.json({ error: 'This request was not sent to you' }, { status: 403 });
    }
    await notifyEmployee(cover.fromEmployeeId, companyId, 'cover_declined_by_teammate', {
      ...payload,
      message: `${myName} cannot cover this shift. The request stays open for others.`,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] cover-request decline failed: ${msg}`);
    return NextResponse.json({ error: 'Could not decline this request' }, { status: 500 });
  }
}

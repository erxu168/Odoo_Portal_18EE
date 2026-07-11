/**
 * POST /api/shifts/cover-requests/[id]/accept  { company_id }
 *
 * Teammate accepts a cover request. Every state-machine guard runs INSIDE the
 * mutation via revalidateForAccept (live slot re-read + lazy expiry); any
 * failure returns 409 {error, code} and never writes Odoo.
 *
 * requireApproval = true  → CAS pending_teammate→pending_manager, notify the
 * requester + managers → {ok:true, status:'pending_manager'}.
 * requireApproval = false → full approve sequence: Odoo write FIRST
 * (resource_id = acceptor's resource), then CAS pending_teammate→auto_applied,
 * then recomputeWeekFlags for BOTH employees' week, then notifications
 * including notifyManagers cover_auto_applied (with undo hint)
 * → {ok:true, status:'auto_applied'}.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { casTransition, clearConfirmation, clearConfirmReminders, getCoverRequest, getShiftSettings } from '@/lib/shifts-db';
import { revalidateForAccept } from '@/lib/shifts-guards';
import { notifyEmployee, notifyManagers } from '@/lib/shifts-notify';
import { fetchEmployees, fetchSlot, recomputeWeekFlags, updateSlot } from '@/lib/shifts-odoo';
import { berlinISOWeekKey, fmtDay, fmtTimeRange } from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

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
    const settings = getShiftSettings(companyId);

    // Every guard runs inside the mutation, against the LIVE slot
    // (includes lazy expiry — an overdue request is expired + notified here).
    const check = await revalidateForAccept(cover, settings, employeeId);
    if (!check.ok) {
      return NextResponse.json({ error: check.message, code: check.code }, { status: 409 });
    }
    const slot = check.slot;

    const employees = await fetchEmployees(companyId);
    const me = employees.find(e => e.id === employeeId);
    if (!me || me.resourceId === null) {
      return NextResponse.json(
        { error: 'Your account cannot be scheduled for shifts' },
        { status: 400 },
      );
    }
    const fromName = employees.find(e => e.id === cover.fromEmployeeId)?.name || slot.employeeName || '';
    const base = {
      day: fmtDay(slot.start),
      time: fmtTimeRange(slot.start, slot.end),
      roleName: slot.roleName,
      requestId,
      slotId: slot.id,
      fromEmployeeId: cover.fromEmployeeId,
      fromName,
      toEmployeeId: employeeId,
      toName: me.name,
    };

    if (settings.requireApproval) {
      const swapped = casTransition(requestId, 'pending_teammate', 'pending_manager', {
        acceptedByEmployeeId: employeeId,
      });
      if (!swapped) {
        const fresh = getCoverRequest(requestId);
        if (fresh && fresh.status === 'pending_manager' && fresh.acceptedByEmployeeId === employeeId) {
          return NextResponse.json({ ok: true, status: 'pending_manager' }); // double-tap safe
        }
        return NextResponse.json(
          { error: 'This request changed while accepting. Please reload.', code: 'state_changed' },
          { status: 409 },
        );
      }
      await notifyEmployee(cover.fromEmployeeId, companyId, 'cover_accepted', {
        ...base,
        message: `${me.name} accepted — waiting for manager approval.`,
      });
      await notifyManagers(companyId, 'cover_accepted', {
        ...base,
        message: `${me.name} wants to cover ${fromName || 'a teammate'}’s shift — approval needed.`,
      });
      return NextResponse.json({ ok: true, status: 'pending_manager' });
    }

    // Auto-apply path (requireApproval = false): full approve sequence.
    // 1) Odoo write FIRST (resource_id = acceptor's resource).
    if (slot.resourceId !== me.resourceId) {
      await updateSlot(slot.id, { resourceId: me.resourceId });
      // New assignee → the giver's confirmation no longer applies; reset it.
      clearConfirmation(slot.id);
      clearConfirmReminders(slot.id);
    }

    // 2) SQLite CAS pending_teammate → auto_applied.
    const swapped = casTransition(requestId, 'pending_teammate', 'auto_applied', {
      acceptedByEmployeeId: employeeId,
      decidedByEmployeeId: employeeId,
    });
    if (!swapped) {
      const fresh = getCoverRequest(requestId);
      if (fresh && (fresh.status === 'auto_applied' || fresh.status === 'approved')) {
        return NextResponse.json({ ok: true, status: fresh.status }); // equivalent apply won the race
      }
      const live = await fetchSlot(cover.slotId);
      if (fresh && live && live.resourceId === me.resourceId) {
        // The Odoo write went through but the request state raced — finalize defensively.
        casTransition(requestId, [fresh.status], 'auto_applied', {
          acceptedByEmployeeId: employeeId,
          decidedByEmployeeId: employeeId,
        });
      } else {
        return NextResponse.json(
          { error: 'This request changed while accepting. Please reload.', code: 'state_changed' },
          { status: 409 },
        );
      }
    }

    // 3) Recompute x_over_cap_flag for BOTH employees' affected week (live).
    await recomputeWeekFlags(companyId, berlinISOWeekKey(slot.start), [cover.fromEmployeeId, employeeId]);

    // 4) Notifications — requester + managers (cover_auto_applied, undo hint).
    await notifyEmployee(cover.fromEmployeeId, companyId, 'cover_auto_applied', {
      ...base,
      message: `${me.name} now covers this shift.`,
    });
    await notifyManagers(companyId, 'cover_auto_applied', {
      ...base,
      message: `${me.name} now covers ${fromName || 'a teammate'}’s shift (applied automatically — you can undo this from Approvals).`,
    });

    return NextResponse.json({ ok: true, status: 'auto_applied' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] cover-request accept failed: ${msg}`);
    return NextResponse.json({ error: 'Could not accept this request' }, { status: 500 });
  }
}

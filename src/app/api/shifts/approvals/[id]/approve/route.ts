/**
 * POST /api/shifts/approvals/[id]/approve {company_id} — manager approves a cover.
 *
 * Order is non-negotiable: revalidateForApprove (live guards + lazy expiry) →
 * Odoo write FIRST (resource_id = acceptor's resource) → SQLite CAS
 * pending_manager→approved → recomputeWeekFlags for BOTH employees' week →
 * notify both. Idempotent: an already-applied slot skips the Odoo write; a
 * raced CAS is defensively finalized when the slot already belongs to the target.
 */
import { NextRequest, NextResponse } from 'next/server';
import { casTransition, clearConfirmation, clearConfirmReminders, getCoverRequest } from '@/lib/shifts-db';
import { revalidateForApprove } from '@/lib/shifts-guards';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fetchEmployees, fetchSlot, recomputeWeekFlags, updateSlot } from '@/lib/shifts-odoo';
import { berlinISOWeekKey } from '@/lib/shifts-time';
import { requireManagerCompany, serverError, slotSummaryPayload } from '../../../_manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { user, companyId } = auth;

    const requestId = parseInt(params.id, 10);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    }

    const cover = getCoverRequest(requestId);
    if (!cover || cover.companyId !== companyId) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (cover.status === 'approved' || cover.status === 'auto_applied') {
      return NextResponse.json({ ok: true }); // idempotent — already applied
    }
    if (cover.status !== 'pending_manager') {
      return NextResponse.json(
        { error: 'This request is not waiting for approval.', code: 'not_pending', status: cover.status },
        { status: 409 },
      );
    }

    // Re-validate against the LIVE slot (includes lazy expiry).
    const check = await revalidateForApprove(cover);
    if (!check.ok) {
      return NextResponse.json({ error: check.message, code: check.code }, { status: 409 });
    }
    const { slot, toResourceId } = check;
    const targetEmployeeId = cover.acceptedByEmployeeId ?? cover.toEmployeeId;
    if (targetEmployeeId === null) {
      return NextResponse.json(
        { error: 'Nobody has accepted this request yet.', code: 'no_acceptor' },
        { status: 409 },
      );
    }

    // Odoo write FIRST. Skip when a prior half-completed approve already applied it.
    if (slot.resourceId !== toResourceId) {
      await updateSlot(slot.id, { resourceId: toResourceId });
      // New assignee → reset any prior confirmation so they confirm fresh.
      clearConfirmation(slot.id);
      clearConfirmReminders(slot.id);
    }

    // SQLite CAS pending_manager → approved.
    const extra =
      typeof user.employee_id === 'number' ? { decidedByEmployeeId: user.employee_id } : undefined;
    const swapped = casTransition(requestId, 'pending_manager', 'approved', extra);
    if (!swapped) {
      const fresh = getCoverRequest(requestId);
      if (fresh && (fresh.status === 'approved' || fresh.status === 'auto_applied')) {
        return NextResponse.json({ ok: true }); // another approve won the race and finishes up
      }
      const live = await fetchSlot(cover.slotId);
      if (!fresh || !live || live.resourceId !== toResourceId) {
        return NextResponse.json(
          { error: 'This request changed while approving. Please reload.', code: 'state_changed' },
          { status: 409 },
        );
      }
      // The Odoo write went through but the request state raced — defensively finalize.
      casTransition(requestId, [fresh.status], 'approved', extra);
    }

    // Recompute over-cap flags for BOTH people in the shift's week (live).
    const weekKey = berlinISOWeekKey(slot.start);
    await recomputeWeekFlags(companyId, weekKey, [cover.fromEmployeeId, targetEmployeeId]);

    // Notify both parties.
    const employees = await fetchEmployees(companyId);
    const fromName = employees.find(e => e.id === cover.fromEmployeeId)?.name || '';
    const toName = employees.find(e => e.id === targetEmployeeId)?.name || '';
    const base = {
      ...slotSummaryPayload(slot, cover.slotSnapshot),
      requestId,
      slotId: slot.id,
      fromName,
      toName,
    };
    await notifyEmployee(cover.fromEmployeeId, companyId, 'cover_approved', {
      ...base,
      message: `${toName || 'Your teammate'} now covers this shift.`,
    });
    await notifyEmployee(targetEmployeeId, companyId, 'cover_approved', {
      ...base,
      message: 'The shift is now yours.',
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('POST approvals/approve', err);
  }
}

/**
 * POST /api/shifts/approvals/[id]/decline {company_id} — manager declines a cover.
 *
 * Defensive per spec: the slot is re-read live first — if its resource already
 * equals the covering person's, a prior approve half-completed after its Odoo
 * write, so the request is finalized as approved instead ({ok:true, note}).
 * Expiry is enforced inside the mutation (lazyExpireIfDue) before declining.
 */
import { NextRequest, NextResponse } from 'next/server';
import { casTransition, getCoverRequest, getShiftSettings } from '@/lib/shifts-db';
import { lazyExpireIfDue } from '@/lib/shifts-guards';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fetchEmployees, fetchSlot, recomputeWeekFlags } from '@/lib/shifts-odoo';
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
    if (cover.status === 'declined_by_manager') {
      return NextResponse.json({ ok: true }); // idempotent
    }
    if (cover.status !== 'pending_manager') {
      return NextResponse.json(
        { error: 'This request is not waiting for approval.', code: 'not_pending', status: cover.status },
        { status: 409 },
      );
    }

    const settings = getShiftSettings(companyId);
    const slot = await fetchSlot(cover.slotId);
    const employees = await fetchEmployees(companyId);
    const targetId = cover.acceptedByEmployeeId ?? cover.toEmployeeId;
    const target = targetId !== null ? employees.find(e => e.id === targetId) : undefined;
    const fromName = employees.find(e => e.id === cover.fromEmployeeId)?.name || '';
    const toName = target?.name || '';
    const extra =
      typeof user.employee_id === 'number' ? { decidedByEmployeeId: user.employee_id } : undefined;
    const base = {
      ...slotSummaryPayload(slot, cover.slotSnapshot),
      requestId,
      slotId: cover.slotId,
      fromName,
      toName,
    };

    // Defensive re-read: a prior approve may have half-completed after its Odoo
    // write. The slot already belongs to the covering person → finalize approved.
    if (
      slot &&
      targetId !== null &&
      target &&
      target.resourceId !== null &&
      slot.resourceId === target.resourceId
    ) {
      casTransition(requestId, 'pending_manager', 'approved', extra);
      await recomputeWeekFlags(companyId, berlinISOWeekKey(slot.start), [cover.fromEmployeeId, targetId]);
      await notifyEmployee(cover.fromEmployeeId, companyId, 'cover_approved', {
        ...base,
        message: `${toName || 'Your teammate'} now covers this shift.`,
      });
      await notifyEmployee(targetId, companyId, 'cover_approved', {
        ...base,
        message: 'The shift is now yours.',
      });
      return NextResponse.json({ ok: true, note: 'already applied' });
    }

    // Expiry is enforced inside every mutation.
    const current = lazyExpireIfDue(cover, slot, settings);
    if (current.status !== 'pending_manager') {
      const expired = current.status === 'expired';
      return NextResponse.json(
        {
          error: expired ? 'This request has expired.' : 'This request is no longer pending.',
          code: expired ? 'expired' : 'state_changed',
        },
        { status: 409 },
      );
    }

    const swapped = casTransition(requestId, 'pending_manager', 'declined_by_manager', extra);
    if (!swapped) {
      const fresh = getCoverRequest(requestId);
      if (fresh && fresh.status === 'declined_by_manager') {
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json(
        { error: 'This request changed while declining. Please reload.', code: 'state_changed' },
        { status: 409 },
      );
    }

    await notifyEmployee(cover.fromEmployeeId, companyId, 'cover_declined', {
      ...base,
      message: 'The manager declined the cover — you still work this shift.',
    });
    if (targetId !== null) {
      await notifyEmployee(targetId, companyId, 'cover_declined', {
        ...base,
        message: `The manager declined this cover — the shift stays with ${fromName || 'your teammate'}.`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('POST approvals/decline', err);
  }
}

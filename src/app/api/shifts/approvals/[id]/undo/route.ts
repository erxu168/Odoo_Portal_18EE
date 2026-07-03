/**
 * POST /api/shifts/approvals/[id]/undo {company_id} — manager undoes a cover.
 *
 * Only approved|auto_applied requests within 24h of decided_at can be undone.
 * Order mirrors approve: Odoo write FIRST (resource back to the original
 * person), then SQLite CAS → 'undone', then recomputeWeekFlags for BOTH
 * employees' week, then notify both. Defensive: if the slot was meanwhile
 * reassigned to a third person, the undo is refused (409) rather than
 * stomping the newer assignment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { casTransition, getCoverRequest } from '@/lib/shifts-db';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fetchEmployees, fetchSlot, recomputeWeekFlags, updateSlot } from '@/lib/shifts-odoo';
import { berlinISOWeekKey } from '@/lib/shifts-time';
import { requireManagerCompany, serverError, slotSummaryPayload } from '../../../_manager';

export const dynamic = 'force-dynamic';

const UNDO_WINDOW_MS = 24 * 3_600_000;

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
    if (cover.status === 'undone') {
      return NextResponse.json({ ok: true }); // idempotent
    }
    if (cover.status !== 'approved' && cover.status !== 'auto_applied') {
      return NextResponse.json(
        { error: 'Only approved covers can be undone.', code: 'not_undoable', status: cover.status },
        { status: 409 },
      );
    }
    const decidedTs = Date.parse(cover.decidedAt ?? cover.updatedAt);
    if (!Number.isFinite(decidedTs) || Date.now() - decidedTs > UNDO_WINDOW_MS) {
      return NextResponse.json(
        { error: 'This cover was decided more than 24 hours ago and can no longer be undone.', code: 'too_old' },
        { status: 409 },
      );
    }

    const employees = await fetchEmployees(companyId);
    const fromEmployee = employees.find(e => e.id === cover.fromEmployeeId);
    if (!fromEmployee || fromEmployee.resourceId === null) {
      return NextResponse.json(
        { error: 'The original person can no longer be scheduled for shifts.', code: 'not_eligible' },
        { status: 409 },
      );
    }
    const targetEmployeeId = cover.acceptedByEmployeeId ?? cover.toEmployeeId;
    const target = targetEmployeeId !== null ? employees.find(e => e.id === targetEmployeeId) : undefined;

    const slot = await fetchSlot(cover.slotId);
    if (!slot) {
      return NextResponse.json(
        { error: 'This shift no longer exists.', code: 'slot_changed' },
        { status: 409 },
      );
    }
    // Defensive: only undo when the slot still belongs to the covering person
    // (or already back with the original — idempotent half-completed undo).
    const targetResourceId = target?.resourceId ?? null;
    if (slot.resourceId !== fromEmployee.resourceId && slot.resourceId !== targetResourceId) {
      return NextResponse.json(
        { error: 'This shift has since been reassigned — nothing to undo.', code: 'slot_changed' },
        { status: 409 },
      );
    }

    // Odoo write FIRST: hand the shift back to the original person.
    if (slot.resourceId !== fromEmployee.resourceId) {
      await updateSlot(slot.id, { resourceId: fromEmployee.resourceId });
    }

    // SQLite CAS approved|auto_applied → undone.
    const extra =
      typeof user.employee_id === 'number' ? { decidedByEmployeeId: user.employee_id } : undefined;
    const swapped = casTransition(requestId, ['approved', 'auto_applied'], 'undone', extra);
    if (!swapped) {
      const fresh = getCoverRequest(requestId);
      if (fresh && fresh.status === 'undone') {
        return NextResponse.json({ ok: true }); // concurrent undo won the race
      }
      return NextResponse.json(
        { error: 'This request changed while undoing. Please reload.', code: 'state_changed' },
        { status: 409 },
      );
    }

    // Recompute over-cap flags for BOTH people in the shift's week (live).
    const weekKey = berlinISOWeekKey(slot.start);
    const affected = [cover.fromEmployeeId];
    if (targetEmployeeId !== null) affected.push(targetEmployeeId);
    await recomputeWeekFlags(companyId, weekKey, affected);

    // Notify both parties.
    const fromName = fromEmployee.name;
    const toName = target?.name || '';
    const base = {
      ...slotSummaryPayload(slot, cover.slotSnapshot),
      requestId,
      slotId: slot.id,
      fromName,
      toName,
    };
    await notifyEmployee(cover.fromEmployeeId, companyId, 'cover_invalidated', {
      ...base,
      message: 'The manager undid the cover — this shift is yours again.',
    });
    if (targetEmployeeId !== null && targetEmployeeId !== cover.fromEmployeeId) {
      await notifyEmployee(targetEmployeeId, companyId, 'cover_invalidated', {
        ...base,
        message: `The manager undid the cover — the shift goes back to ${fromName || 'your teammate'}.`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('POST approvals/undo', err);
  }
}

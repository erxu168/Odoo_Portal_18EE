/**
 * POST /api/shifts/claim  { company_id, slot_id, confirm?: boolean }
 *
 * Staff claims an open shift. The slot is revalidated LIVE inside the
 * mutation: published, unassigned, in the future, role-eligible. When the
 * projected week total exceeds the claimer's cap and confirm !== true the
 * route returns a needsConfirm payload instead of writing; a confirmed
 * over-cap claim notifies the managers. 409 when someone already took it.
 * After the write: recomputeWeekFlags for the claimer's week.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { notifyManagers } from '@/lib/shifts-notify';
import {
  employeeWeekHours,
  fetchEmployees,
  fetchSlot,
  recomputeWeekFlags,
  updateSlot,
} from '@/lib/shifts-odoo';
import { berlinISOWeekKey, fmtDay, fmtTimeRange, odooToDate } from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { company_id?: unknown; slot_id?: unknown; confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const companyId = typeof body.company_id === 'number' ? body.company_id : parseInt(String(body.company_id ?? ''), 10);
  const slotId = typeof body.slot_id === 'number' ? body.slot_id : parseInt(String(body.slot_id ?? ''), 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  }
  if (!Number.isFinite(slotId) || slotId <= 0) {
    return NextResponse.json({ error: 'slot_id is required' }, { status: 400 });
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

  try {
    // Live revalidation — never trust the list the client rendered from.
    const slot = await fetchSlot(slotId);
    if (!slot || slot.companyId !== companyId) {
      return NextResponse.json({ error: 'This shift no longer exists' }, { status: 404 });
    }
    if (slot.state !== 'published') {
      return NextResponse.json({ error: 'This shift is not available' }, { status: 409 });
    }
    if (slot.resourceId !== null) {
      return NextResponse.json({ error: 'Someone already took this shift' }, { status: 409 });
    }
    if (odooToDate(slot.start).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This shift has already started' }, { status: 409 });
    }

    const employees = await fetchEmployees(companyId);
    const me = employees.find(e => e.id === employeeId);
    if (!me || me.resourceId === null) {
      return NextResponse.json(
        { error: 'Your account cannot be scheduled for shifts' },
        { status: 400 },
      );
    }
    if (slot.roleId !== null && !me.roleIds.includes(slot.roleId)) {
      return NextResponse.json({ error: 'You cannot work this role' }, { status: 403 });
    }

    // Live cap projection for the shift's week.
    const weekKey = berlinISOWeekKey(slot.start);
    const current = await employeeWeekHours(employeeId, weekKey);
    const projected = round2(current + slot.hours);
    const cap = me.cap;
    const overCap = cap !== null && projected > cap;
    if (overCap && body.confirm !== true) {
      return NextResponse.json({
        needsConfirm: true,
        projected,
        cap,
        overage: round2(projected - (cap ?? 0)),
      });
    }

    await updateSlot(slot.id, { resourceId: me.resourceId });

    // Best-effort race check: if another claim landed after ours, surface it.
    const after = await fetchSlot(slot.id);
    if (after && after.resourceId !== null && after.resourceId !== me.resourceId) {
      return NextResponse.json({ error: 'Someone already took this shift' }, { status: 409 });
    }

    await recomputeWeekFlags(companyId, weekKey, [employeeId]);

    if (overCap) {
      await notifyManagers(companyId, 'claim_over_cap', {
        day: fmtDay(slot.start),
        time: fmtTimeRange(slot.start, slot.end),
        roleName: slot.roleName,
        slotId: slot.id,
        employeeId,
        employeeName: me.name,
        projected,
        cap,
        overage: round2(projected - (cap ?? 0)),
        message: `${me.name} took this shift over their weekly cap.`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] claim failed: ${msg}`);
    return NextResponse.json({ error: 'Could not claim this shift' }, { status: 500 });
  }
}

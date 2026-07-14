/**
 * POST /api/shifts/sick-reports  { company_id, slot_id, note? }
 *
 * Staff reports sick for one of their shifts. Settings-gated
 * (allowSickReport); always allowed regardless of the settle buffer — being
 * sick does not follow deadlines. The slot must be the reporter's own and not
 * already over. Managers are notified (sick_reported) and resolve it from the
 * Approvals queue (reopen to the pool / keep assigned).
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { createSickReport, getShiftSettings } from '@/lib/shifts-db';
import { notifyManagers } from '@/lib/shifts-notify';
import { fetchSlot } from '@/lib/shifts-odoo';
import { fmtDay, fmtTimeRange, odooToDate } from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { company_id?: unknown; slot_id?: unknown; note?: unknown };
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
  const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;

  try {
    const settings = getShiftSettings(companyId);
    if (!settings.allowSickReport) {
      return NextResponse.json(
        { error: 'Sick reports are not enabled for this restaurant' },
        { status: 403 },
      );
    }

    // Guards against the LIVE slot: mine and not already over.
    const slot = await fetchSlot(slotId);
    if (!slot || slot.companyId !== companyId) {
      return NextResponse.json({ error: 'This shift no longer exists' }, { status: 404 });
    }
    if (slot.employeeId !== employeeId) {
      return NextResponse.json({ error: 'This is not your shift' }, { status: 403 });
    }
    if (odooToDate(slot.end).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This shift is already over' }, { status: 409 });
    }

    const reportId = createSickReport({ slotId: slot.id, companyId, employeeId, note });

    await notifyManagers(companyId, 'sick_reported', {
      day: fmtDay(slot.start),
      time: fmtTimeRange(slot.start, slot.end),
      roleName: slot.roleName,
      reportId,
      slotId: slot.id,
      employeeId,
      employeeName: slot.employeeName || user.name,
      note,
      message: `${slot.employeeName || user.name} reported sick for this shift.`,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] sick-report create failed: ${msg}`);
    return NextResponse.json({ error: 'Could not send the sick report' }, { status: 500 });
  }
}

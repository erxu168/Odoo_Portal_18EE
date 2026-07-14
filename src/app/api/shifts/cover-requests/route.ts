/**
 * POST /api/shifts/cover-requests
 * { company_id, slot_id, to_employee_id? | ask_all?: true, message? }
 *
 * Staff asks a teammate (or everyone eligible) to cover one of their shifts.
 * Guards inside the mutation: the slot is mine, published, and further than
 * the settle buffer from starting; a direct target must be role-eligible and
 * not already scheduled at that time. Ask-all is settings-gated (403).
 * Active-request uniqueness per slot is enforced by the partial unique index
 * (409 'There is already an open request for this shift').
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { createCoverRequest, getShiftSettings } from '@/lib/shifts-db';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fetchEmployees, fetchSlot } from '@/lib/shifts-odoo';
import { fmtDay, fmtTimeRange, odooToDate } from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

const HOUR_MS = 3_600_000;

/** Does the employee already have any assigned slot overlapping [start, end)? */
async function hasOverlappingSlot(
  employeeId: number,
  startOdoo: string,
  endOdoo: string,
  excludeSlotId: number,
): Promise<boolean> {
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['employee_id', '=', employeeId],
      ['start_datetime', '<', endOdoo],
      ['end_datetime', '>', startOdoo],
      ['id', '!=', excludeSlotId],
    ],
    ['id'],
    { limit: 1 },
  )) as Record<string, unknown>[];
  return rows.length > 0;
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    company_id?: unknown;
    slot_id?: unknown;
    to_employee_id?: unknown;
    ask_all?: unknown;
    message?: unknown;
  };
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

  const askAll = body.ask_all === true;
  const toEmployeeId = typeof body.to_employee_id === 'number' ? body.to_employee_id : null;
  const message = typeof body.message === 'string' && body.message.trim() !== '' ? body.message.trim() : null;

  try {
    const settings = getShiftSettings(companyId);
    if (askAll && !settings.allowAskAll) {
      return NextResponse.json(
        { error: 'Asking everyone at once is not enabled for this restaurant' },
        { status: 403 },
      );
    }
    if (!askAll && toEmployeeId === null) {
      return NextResponse.json({ error: 'Choose a teammate to ask' }, { status: 400 });
    }

    // Guards against the LIVE slot.
    const slot = await fetchSlot(slotId);
    if (!slot || slot.companyId !== companyId) {
      return NextResponse.json({ error: 'This shift no longer exists' }, { status: 404 });
    }
    if (slot.employeeId !== employeeId) {
      return NextResponse.json({ error: 'This is not your shift' }, { status: 403 });
    }
    if (slot.state !== 'published') {
      return NextResponse.json({ error: 'This shift is not published yet' }, { status: 409 });
    }
    const settleCutoff = odooToDate(slot.start).getTime() - settings.settleBufferHours * HOUR_MS;
    if (Date.now() >= settleCutoff) {
      return NextResponse.json(
        { error: 'This shift starts too soon to arrange cover' },
        { status: 409 },
      );
    }

    const employees = await fetchEmployees(companyId);

    let target: (typeof employees)[number] | undefined;
    if (!askAll && toEmployeeId !== null) {
      if (toEmployeeId === employeeId) {
        return NextResponse.json({ error: 'You cannot ask yourself' }, { status: 400 });
      }
      target = employees.find(e => e.id === toEmployeeId);
      if (!target || target.resourceId === null) {
        return NextResponse.json(
          { error: 'This teammate cannot be scheduled for shifts' },
          { status: 400 },
        );
      }
      if (slot.roleId !== null && !target.roleIds.includes(slot.roleId)) {
        return NextResponse.json({ error: 'This teammate cannot work this role' }, { status: 400 });
      }
      if (await hasOverlappingSlot(target.id, slot.start, slot.end, slot.id)) {
        return NextResponse.json(
          { error: 'This teammate already has a shift at that time' },
          { status: 400 },
        );
      }
    }

    const answerDeadline = new Date(
      Date.now() + settings.answerDeadlineHours * HOUR_MS,
    ).toISOString();

    const result = createCoverRequest({
      slotId: slot.id,
      companyId,
      fromEmployeeId: employeeId,
      toEmployeeId: askAll ? null : toEmployeeId,
      askAll,
      message,
      slotSnapshot: {
        start: slot.start,
        end: slot.end,
        roleId: slot.roleId,
        resourceId: slot.resourceId,
      },
      answerDeadline,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'There is already an open request for this shift' },
        { status: 409 },
      );
    }

    const payload = {
      day: fmtDay(slot.start),
      time: fmtTimeRange(slot.start, slot.end),
      roleName: slot.roleName,
      requestId: result.id,
      slotId: slot.id,
      fromEmployeeId: employeeId,
      fromName: slot.employeeName || user.name,
      message,
      answerDeadline,
    };
    if (askAll) {
      const recipients = employees.filter(e =>
        e.id !== employeeId &&
        e.resourceId !== null &&
        (slot.roleId === null || e.roleIds.includes(slot.roleId)),
      );
      for (const recipient of recipients) {
        await notifyEmployee(recipient.id, companyId, 'cover_request_received', payload);
      }
    } else if (target) {
      await notifyEmployee(target.id, companyId, 'cover_request_received', payload);
    }

    return NextResponse.json({ ok: true, id: result.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] cover-request create failed: ${msg}`);
    return NextResponse.json({ error: 'Could not create the cover request' }, { status: 500 });
  }
}

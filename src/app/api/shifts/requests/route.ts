/**
 * GET /api/shifts/requests?company_id=
 *
 * The viewer's cover-request inbox.
 * incoming: pending_teammate requests directed to me OR ask-all requests I am
 * role-eligible for (and did not send), PLUS requests I accepted that are
 * waiting for the manager. Each item carries a live slot summary, the
 * message, the deadline, the requester's name and the hour projection FOR
 * THE VIEWER (V2.1 contract).
 * outgoing: my own requests with status, slot summary and canCancel.
 *
 * GET routes apply lazyExpireIfDue to any pending requests they touch.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getShiftSettings, listCoverRequests } from '@/lib/shifts-db';
import { lazyExpireIfDue } from '@/lib/shifts-guards';
import { employeeWeekHours, fetchEmployees, fetchSlot } from '@/lib/shifts-odoo';
import { berlinISOWeekKey, durationHours, fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import type { CoverRequest, ShiftSlot } from '@/types/shifts';

export const dynamic = 'force-dynamic';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function slotSummary(start: string, end: string, roleName: string) {
  return {
    day: start ? fmtDay(start) : '',
    timeRange: start && end ? fmtTimeRange(start, end) : '',
    roleName,
    hours: start && end ? durationHours(start, end) : 0,
    start,
  };
}

export async function GET(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const companyId = parseInt(searchParams.get('company_id') || '', 10);
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

  try {
    const settings = getShiftSettings(companyId);
    const [employees, all] = await Promise.all([
      fetchEmployees(companyId),
      Promise.resolve(listCoverRequests({ companyId, limit: 100 })),
    ]);
    const me = employees.find(e => e.id === employeeId);
    const nameById = new Map(employees.map(e => [e.id, e.name]));

    // Live slots for all pending requests, deduped, then lazy expiry.
    const pendingIds = Array.from(
      new Set(
        all
          .filter(r => r.status === 'pending_teammate' || r.status === 'pending_manager')
          .map(r => r.slotId),
      ),
    );
    const slotById = new Map<number, ShiftSlot | null>();
    const fetched = await Promise.all(pendingIds.map(id => fetchSlot(id)));
    pendingIds.forEach((id, i) => slotById.set(id, fetched[i]));

    const requests: CoverRequest[] = all.map(req =>
      req.status === 'pending_teammate' || req.status === 'pending_manager'
        ? lazyExpireIfDue(req, slotById.get(req.slotId) ?? null, settings)
        : req,
    );

    // My live week hours per distinct shift week (for the viewer projection).
    const myHoursByWeek = new Map<string, number>();
    const myWeekHours = async (weekKey: string): Promise<number> => {
      if (!myHoursByWeek.has(weekKey)) {
        myHoursByWeek.set(weekKey, await employeeWeekHours(employeeId, weekKey));
      }
      return myHoursByWeek.get(weekKey) ?? 0;
    };

    const incoming = [];
    for (const req of requests) {
      const slot = slotById.get(req.slotId) ?? null;
      const directedToMe = req.status === 'pending_teammate' && req.toEmployeeId === employeeId;
      const askAllForMe =
        req.status === 'pending_teammate' &&
        req.askAll &&
        req.fromEmployeeId !== employeeId &&
        me !== undefined &&
        me.resourceId !== null &&
        (slot
          ? slot.roleId === null || me.roleIds.includes(slot.roleId)
          : req.slotSnapshot.roleId === null || me.roleIds.includes(req.slotSnapshot.roleId));
      const acceptedByMe = req.status === 'pending_manager' && req.acceptedByEmployeeId === employeeId;
      if (!directedToMe && !askAllForMe && !acceptedByMe) continue;
      if (!slot) continue; // slot vanished — nothing actionable to show

      const shiftHours = slot.hours;
      const weekHours = await myWeekHours(berlinISOWeekKey(slot.start));
      const projected = round2(weekHours + shiftHours);
      const cap = me?.cap ?? null;
      incoming.push({
        id: req.id,
        slotId: req.slotId,
        status: req.status,
        askAll: req.askAll,
        fromEmployeeId: req.fromEmployeeId,
        fromName: nameById.get(req.fromEmployeeId) ?? '',
        message: req.message,
        answerDeadline: req.answerDeadline,
        slot: slotSummary(slot.start, slot.end, slot.roleName),
        projection: {
          projected,
          cap,
          overage: cap !== null && projected > cap ? round2(projected - cap) : 0,
        },
        requireApproval: settings.requireApproval,
      });
    }

    const outgoing = requests
      .filter(req => req.fromEmployeeId === employeeId)
      .slice(0, 30)
      .map(req => {
        const slot = slotById.get(req.slotId) ?? null;
        const snap = req.slotSnapshot;
        return {
          id: req.id,
          slotId: req.slotId,
          status: req.status,
          askAll: req.askAll,
          toEmployeeId: req.toEmployeeId,
          toName: req.askAll
            ? 'Everyone eligible'
            : (req.toEmployeeId !== null ? nameById.get(req.toEmployeeId) ?? '' : ''),
          acceptedByName:
            req.acceptedByEmployeeId !== null ? nameById.get(req.acceptedByEmployeeId) ?? '' : '',
          message: req.message,
          answerDeadline: req.answerDeadline,
          slot: slotSummary(slot?.start || snap.start, slot?.end || snap.end, slot?.roleName || ''),
          canCancel: req.status === 'pending_teammate' || req.status === 'pending_manager',
        };
      });

    return NextResponse.json({ incoming, outgoing });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] requests failed: ${msg}`);
    return NextResponse.json({ error: 'Could not load requests' }, { status: 500 });
  }
}

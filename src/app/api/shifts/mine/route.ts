/**
 * GET /api/shifts/mine?company_id=&week=2026-W28
 *
 * The viewer's week: own published slots grouped per Berlin day, live week
 * hours vs cap, own outgoing cover requests (statuses for the agenda chips),
 * incoming request count, tentative slots (accepted but not yet decided),
 * plus — per V2.1 contract — eligibleBySlot for the cover picker and the
 * settings subset the screen needs.
 *
 * GET routes apply lazyExpireIfDue to any pending requests they touch.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { confirmedSlotIds, getShiftSettings, listCoverRequests, slotDepartments } from '@/lib/shifts-db';
import { lazyExpireIfDue } from '@/lib/shifts-guards';
import { fetchDepartments, fetchEmployees, fetchSlot, fetchWeekSlots, weekHoursMap } from '@/lib/shifts-odoo';
import {
  berlinParts,
  currentWeekKey,
  durationHours,
  fmtDay,
  fmtTimeRange,
  odooToDate,
  weekKeyDays,
} from '@/lib/shifts-time';
import type { CoverRequest, ShiftSlot } from '@/types/shifts';

export const dynamic = 'force-dynamic';

function slotSummary(start: string, end: string, roleName: string) {
  return {
    day: fmtDay(start),
    timeRange: fmtTimeRange(start, end),
    roleName,
    hours: durationHours(start, end),
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

  const weekParam = searchParams.get('week') || '';
  const weekKey = /^\d{4}-W\d{1,2}$/.test(weekParam) ? weekParam : currentWeekKey();

  try {
    const settings = getShiftSettings(companyId);
    const [weekSlots, employees, hoursMap] = await Promise.all([
      fetchWeekSlots(companyId, weekKey),
      fetchEmployees(companyId),
      weekHoursMap(companyId, weekKey),
    ]);

    const me = employees.find(e => e.id === employeeId);
    const nameById = new Map(employees.map(e => [e.id, e.name]));
    const slotById = new Map<number, ShiftSlot>(weekSlots.map(s => [s.id, s]));

    // Live slot for a request — week cache first, then a direct read.
    const extraSlots = new Map<number, ShiftSlot | null>();
    const liveSlot = async (slotId: number): Promise<ShiftSlot | null> => {
      const cached = slotById.get(slotId);
      if (cached) return cached;
      if (!extraSlots.has(slotId)) extraSlots.set(slotId, await fetchSlot(slotId));
      return extraSlots.get(slotId) ?? null;
    };
    const expire = async (req: CoverRequest): Promise<CoverRequest> =>
      lazyExpireIfDue(req, await liveSlot(req.slotId), settings);

    // Staff only ever see published shifts — drafts are invisible until publish.
    const mineSlots = weekSlots.filter(s => s.employeeId === employeeId && s.state === 'published');
    // Overlay the manager-chosen department so staff see where they're posted.
    const deptOv = slotDepartments(companyId, mineSlots.map(s => s.id));
    if (deptOv.size > 0) {
      const deptNameById = new Map((await fetchDepartments(companyId)).map(d => [d.id, d.name]));
      for (const s of mineSlots) {
        const ov = deptOv.get(s.id);
        if (ov !== undefined) {
          s.departmentId = ov;
          s.departmentName = deptNameById.get(ov) ?? s.departmentName;
        }
      }
    }
    const confirmedIds = confirmedSlotIds(companyId);
    const myConfirmed = mineSlots.filter(s => confirmedIds.has(s.id)).map(s => s.id);
    const days = weekKeyDays(weekKey).map(date => ({
      date,
      slots: mineSlots.filter(s => berlinParts(s.start).date === date),
    }));

    // Outgoing pending requests (agenda status chips + cancel).
    const outgoingRaw = listCoverRequests({
      companyId,
      fromEmployeeId: employeeId,
      status: ['pending_teammate', 'pending_manager'],
    });
    const outgoing = [];
    for (const raw of outgoingRaw) {
      const req = await expire(raw);
      if (req.status !== 'pending_teammate' && req.status !== 'pending_manager') continue;
      const slot = await liveSlot(req.slotId);
      const snap = req.slotSnapshot;
      outgoing.push({
        id: req.id,
        slotId: req.slotId,
        status: req.status,
        askAll: req.askAll,
        toEmployeeId: req.toEmployeeId,
        toName: req.askAll
          ? 'Everyone eligible'
          : (req.toEmployeeId !== null ? nameById.get(req.toEmployeeId) ?? '' : ''),
        acceptedByEmployeeId: req.acceptedByEmployeeId,
        acceptedByName:
          req.acceptedByEmployeeId !== null ? nameById.get(req.acceptedByEmployeeId) ?? '' : '',
        message: req.message,
        answerDeadline: req.answerDeadline,
        slot: slotSummary(slot?.start || snap.start, slot?.end || snap.end, slot?.roleName || ''),
        canCancel: true,
      });
    }

    // Incoming pending count (directed to me, or ask-all I am eligible for).
    const incomingRaw = listCoverRequests({ companyId, status: ['pending_teammate'] });
    let incomingCount = 0;
    for (const raw of incomingRaw) {
      const req = await expire(raw);
      if (req.status !== 'pending_teammate') continue;
      if (req.toEmployeeId === employeeId) {
        incomingCount += 1;
        continue;
      }
      if (!req.askAll || req.fromEmployeeId === employeeId) continue;
      if (!me || me.resourceId === null) continue;
      const slot = await liveSlot(req.slotId);
      const roleId = slot ? slot.roleId : req.slotSnapshot.roleId;
      if (roleId === null || me.roleIds.includes(roleId)) incomingCount += 1;
    }

    // Tentative: I accepted, manager has not decided — "Pending, not yours yet".
    const tentativeRaw = listCoverRequests({ companyId, status: ['pending_manager'] })
      .filter(r => r.acceptedByEmployeeId === employeeId);
    const tentative = [];
    for (const raw of tentativeRaw) {
      const req = await expire(raw);
      if (req.status !== 'pending_manager') continue;
      const slot = await liveSlot(req.slotId);
      if (slot) tentative.push({ ...slot, requestId: req.id });
    }

    // V2.1: eligible teammates per future published slot of mine (cover picker).
    const nowMs = Date.now();
    const eligibleBySlot: Record<
      number,
      Array<{ employeeId: number; name: string; weekHours: number; cap: number | null; overlap: boolean }>
    > = {};
    const assigned = weekSlots.filter(s => s.employeeId !== null);
    for (const slot of mineSlots) {
      if (odooToDate(slot.start).getTime() <= nowMs) continue;
      eligibleBySlot[slot.id] = employees
        .filter(e =>
          e.id !== employeeId &&
          e.resourceId !== null &&
          (slot.roleId === null || e.roleIds.includes(slot.roleId)),
        )
        .map(e => ({
          employeeId: e.id,
          name: e.name,
          weekHours: hoursMap.get(e.id) ?? 0,
          cap: e.cap,
          overlap: assigned.some(
            s2 => s2.id !== slot.id && s2.employeeId === e.id && s2.start < slot.end && s2.end > slot.start,
          ),
        }));
    }

    return NextResponse.json({
      weekKey,
      days,
      confirmedSlotIds: myConfirmed,
      weekHours: hoursMap.get(employeeId) ?? 0,
      cap: me?.cap ?? null,
      requests: { outgoing, incomingCount },
      tentative,
      eligibleBySlot,
      settings: {
        allowAskAll: settings.allowAskAll,
        allowSickReport: settings.allowSickReport,
        answerDeadlineHours: settings.answerDeadlineHours,
        requireApproval: settings.requireApproval,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] mine failed: ${msg}`);
    return NextResponse.json({ error: 'Could not load your shifts' }, { status: 500 });
  }
}

/**
 * GET /api/shifts/approvals?company_id= — manager approval queue.
 *
 * Pending covers are lazy-expired first (expiry is enforced inside every read/
 * mutation, never render-time only) and carry LIVE hour projections computed
 * via employeeWeekHours — never from snapshots. Also returns open sick reports,
 * recently auto-applied covers (24h undo window) and the last 10 decided.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getShiftSettings, listCoverRequests, listSickReports } from '@/lib/shifts-db';
import { lazyExpireIfDue } from '@/lib/shifts-guards';
import { employeeWeekHours, fetchEmployees, fetchRoles, fetchSlot } from '@/lib/shifts-odoo';
import { berlinISOWeekKey, durationHours, fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import type { CoverRequest } from '@/types/shifts';
import { requireManagerCompany, round2, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

const UNDO_WINDOW_MS = 24 * 3_600_000;

export async function GET(req: NextRequest) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const settings = getShiftSettings(companyId);
    const [employees, roles] = await Promise.all([fetchEmployees(companyId), fetchRoles(companyId)]);
    const nameOf = (id: number | null): string =>
      id === null ? '' : employees.find(e => e.id === id)?.name || '';
    const roleNameOf = (id: number | null): string =>
      id === null ? '' : roles.find(r => r.id === id)?.name || '';

    // -- Pending manager approvals: lazy-expire, then LIVE projections --------
    const pending = [];
    for (const row of listCoverRequests({ companyId, status: ['pending_manager'] })) {
      const slot = await fetchSlot(row.slotId);
      const current = lazyExpireIfDue(row, slot, settings);
      if (current.status !== 'pending_manager' || !slot) continue;
      const targetId = current.acceptedByEmployeeId ?? current.toEmployeeId;
      const weekKey = berlinISOWeekKey(slot.start);
      const fromBefore = await employeeWeekHours(current.fromEmployeeId, weekKey);
      const toBefore = targetId !== null ? await employeeWeekHours(targetId, weekKey) : 0;
      const cap = targetId !== null ? employees.find(e => e.id === targetId)?.cap ?? null : null;
      const toAfter = round2(toBefore + slot.hours);
      pending.push({
        id: current.id,
        slotId: current.slotId,
        status: current.status,
        askAll: current.askAll,
        message: current.message,
        answerDeadline: current.answerDeadline,
        createdAt: current.createdAt,
        fromEmployeeId: current.fromEmployeeId,
        toEmployeeId: targetId,
        fromName: nameOf(current.fromEmployeeId),
        toName: nameOf(targetId),
        slot: {
          id: slot.id,
          day: fmtDay(slot.start),
          timeRange: fmtTimeRange(slot.start, slot.end),
          roleName: slot.roleName,
          hours: slot.hours,
          start: slot.start,
          end: slot.end,
        },
        hours: {
          fromBefore,
          fromAfter: round2(fromBefore - slot.hours),
          toBefore,
          toAfter,
          cap,
          overage: cap !== null ? Math.max(0, round2(toAfter - cap)) : 0,
        },
      });
    }

    // -- Open sick reports with live slot + person ----------------------------
    const sick = [];
    for (const report of listSickReports(companyId, 'open')) {
      const slot = await fetchSlot(report.slotId);
      sick.push({
        id: report.id,
        slotId: report.slotId,
        employeeId: report.employeeId,
        employeeName: nameOf(report.employeeId),
        note: report.note,
        createdAt: report.createdAt,
        slot: slot
          ? {
              id: slot.id,
              day: fmtDay(slot.start),
              timeRange: fmtTimeRange(slot.start, slot.end),
              roleName: slot.roleName,
              hours: slot.hours,
              start: slot.start,
            }
          : null,
      });
    }

    // -- Recently auto-applied (undoable) + last 10 decided --------------------
    const now = Date.now();
    const canUndo = (r: CoverRequest): boolean => {
      if (r.status !== 'approved' && r.status !== 'auto_applied') return false;
      const ts = Date.parse(r.decidedAt ?? r.updatedAt);
      return Number.isFinite(ts) && now - ts <= UNDO_WINDOW_MS;
    };
    const summarize = (r: CoverRequest) => ({
      id: r.id,
      slotId: r.slotId,
      status: r.status,
      askAll: r.askAll,
      fromEmployeeId: r.fromEmployeeId,
      toEmployeeId: r.acceptedByEmployeeId ?? r.toEmployeeId,
      fromName: nameOf(r.fromEmployeeId),
      toName: nameOf(r.acceptedByEmployeeId ?? r.toEmployeeId),
      decidedAt: r.decidedAt ?? r.updatedAt,
      canUndo: canUndo(r),
      slot: {
        day: r.slotSnapshot.start ? fmtDay(r.slotSnapshot.start) : '',
        timeRange:
          r.slotSnapshot.start && r.slotSnapshot.end
            ? fmtTimeRange(r.slotSnapshot.start, r.slotSnapshot.end)
            : '',
        roleName: roleNameOf(r.slotSnapshot.roleId),
        hours:
          r.slotSnapshot.start && r.slotSnapshot.end
            ? durationHours(r.slotSnapshot.start, r.slotSnapshot.end)
            : 0,
      },
    });

    const recentAuto = listCoverRequests({ companyId, status: ['auto_applied'], limit: 20 })
      .filter(canUndo)
      .map(summarize);
    const decided = listCoverRequests({
      companyId,
      status: ['approved', 'auto_applied', 'declined_by_manager', 'undone'],
      limit: 10,
    }).map(summarize);

    return NextResponse.json({ pending, sick, recentAuto, decided });
  } catch (err: unknown) {
    return serverError('GET approvals', err);
  }
}

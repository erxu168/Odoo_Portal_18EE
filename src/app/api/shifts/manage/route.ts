/**
 * GET /api/shifts/manage?company_id=&week= — manager schedule grid data.
 *
 * Returns the week's 7 Berlin dates, employees enriched with live week hours
 * and over-cap state, the roles, all slots of the week, per-day/assigned/open
 * hour totals and the slot ids that carry a pending cover request (chips show
 * a ⚠). Pending requests are lazy-expired before being counted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getShiftSettings, listCoverRequests, slotDepartments } from '@/lib/shifts-db';
import { lazyExpireIfDue } from '@/lib/shifts-guards';
import { fetchDepartments, fetchEmployees, fetchRoles, fetchWeekSlots, weekHoursMap } from '@/lib/shifts-odoo';
import { berlinParts, weekKeyDays } from '@/lib/shifts-time';
import { requireManagerCompany, resolveWeekKey, round2, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const weekKey = resolveWeekKey(req.nextUrl.searchParams.get('week'));
    if (!weekKey) {
      return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
    }

    const [slots, employees, roles, departments, hoursMap] = await Promise.all([
      fetchWeekSlots(companyId, weekKey),
      fetchEmployees(companyId),
      fetchRoles(companyId),
      fetchDepartments(companyId),
      weekHoursMap(companyId, weekKey),
    ]);

    // Overlay the manager's chosen department (portal-side) onto each slot — the
    // Odoo department_id is a readonly relation and empty for open shifts.
    const deptOverride = slotDepartments(companyId, slots.map(s => s.id));
    const deptNameById = new Map(departments.map(d => [d.id, d.name]));
    for (const s of slots) {
      const ov = deptOverride.get(s.id);
      if (ov !== undefined) {
        s.departmentId = ov;
        s.departmentName = deptNameById.get(ov) ?? s.departmentName;
      }
    }

    const days = weekKeyDays(weekKey);
    const dayIndex = new Map(days.map((d, i) => [d, i]));
    const perDay = [0, 0, 0, 0, 0, 0, 0];
    let assigned = 0;
    let open = 0;
    for (const slot of slots) {
      const idx = dayIndex.get(berlinParts(slot.start).date);
      if (idx !== undefined) perDay[idx] = round2(perDay[idx] + slot.hours);
      if (slot.resourceId !== null) assigned += slot.hours;
      else open += slot.hours;
    }

    const employeesOut = employees.map(e => {
      const hours = hoursMap.get(e.id) ?? 0;
      return { ...e, hours, overCap: e.cap !== null && hours > e.cap + 1e-9 };
    });

    // Slot ids with a still-pending cover request (lazy-expired first, only
    // requests whose slot is in this week's grid matter here).
    const settings = getShiftSettings(companyId);
    const slotById = new Map(slots.map(s => [s.id, s]));
    const pendingRequestSlotIds: number[] = [];
    for (const request of listCoverRequests({
      companyId,
      status: ['pending_teammate', 'pending_manager'],
    })) {
      const slot = slotById.get(request.slotId);
      if (!slot) continue;
      const current = lazyExpireIfDue(request, slot, settings);
      if (current.status === 'pending_teammate' || current.status === 'pending_manager') {
        pendingRequestSlotIds.push(request.slotId);
      }
    }

    return NextResponse.json({
      weekKey,
      days,
      employees: employeesOut,
      roles,
      departments,
      slots,
      totals: { perDay, assigned: round2(assigned), open: round2(open) },
      pendingRequestSlotIds,
    });
  } catch (err: unknown) {
    return serverError('GET manage', err);
  }
}

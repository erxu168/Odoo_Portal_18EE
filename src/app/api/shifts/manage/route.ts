/**
 * GET /api/shifts/manage?company_id=&week= — manager schedule grid data.
 *
 * Returns the week's 7 Berlin dates, employees enriched with live week hours
 * and over-cap state, the roles, all slots of the week, per-day/assigned/open
 * hour totals and the slot ids that carry a pending cover request (chips show
 * a ⚠). Pending requests are lazy-expired before being counted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getShiftSettings, listCoverRequests, slotDepartments, slotMinSkills } from '@/lib/shifts-db';
import { lazyExpireIfDue } from '@/lib/shifts-guards';
import { fetchDepartments, fetchEmployees, fetchRoles, fetchWeekSlots, weekHoursMap } from '@/lib/shifts-odoo';
import { minimumWageForDate, shiftLabourCost } from '@/lib/shift-labour-cost';
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
    const slotIds = slots.map(s => s.id);
    const deptOverride = slotDepartments(companyId, slotIds);
    const skillOverride = slotMinSkills(companyId, slotIds);
    const deptNameById = new Map(departments.map(d => [d.id, d.name]));
    for (const s of slots) {
      const ov = deptOverride.get(s.id);
      if (ov !== undefined) {
        s.departmentId = ov;
        s.departmentName = deptNameById.get(ov) ?? s.departmentName;
      }
      s.minSkill = skillOverride.get(s.id) ?? null;
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

    const settings = getShiftSettings(companyId);

    // Fully-loaded labour cost per slot = hours × €/h × (1 + employer on-cost %).
    // Assigned → the person's contract rate + their AG rate; open → an estimate at
    // the statutory minimum wage using the regular AG rate.
    const empById = new Map(employees.map(e => [e.id, e]));
    const costPerDay = [0, 0, 0, 0, 0, 0, 0];
    let costWeek = 0;
    let costEstimatedAny = false;
    for (const s of slots) {
      const date = berlinParts(s.start).date;
      const emp = s.employeeId !== null ? empById.get(s.employeeId) : undefined;
      // Exact only when the assignee is on the roster WITH a contract rate on file.
      // Open shifts, off-roster assignees, or staff with no contract → estimate at
      // the minimum wage that applies on the shift's date (their AG rate if known).
      const hasRate = emp?.hasContract === true;
      const estimated = !hasRate;
      const rate = hasRate ? emp!.hourlyRate : minimumWageForDate(date);
      const agPct = emp && emp.employmentType === 'minijob' ? settings.agCostMinijob : settings.agCostRegular;
      s.cost = shiftLabourCost(s.hours, rate, agPct);
      s.costEstimated = estimated;
      if (estimated) costEstimatedAny = true;
      const idx = dayIndex.get(date);
      if (idx !== undefined) costPerDay[idx] = round2(costPerDay[idx] + s.cost);
      costWeek += s.cost;
    }

    // Slot ids with a still-pending cover request (lazy-expired first, only
    // requests whose slot is in this week's grid matter here).
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
      totals: {
        perDay,
        assigned: round2(assigned),
        open: round2(open),
        costPerDay,
        costWeek: round2(costWeek),
        costEstimatedAny,
      },
      pendingRequestSlotIds,
    });
  } catch (err: unknown) {
    return serverError('GET manage', err);
  }
}

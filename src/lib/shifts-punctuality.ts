/**
 * Shifts module — punctuality tallies (late-in / left-early / overtime).
 *
 * Matches hr.attendance records to their scheduled planning.slot (via
 * attendance.planning_slot_id, which the kiosk sets on clock-in) and compares
 * clock times to the schedule:
 *   late-in    = check_in later than slot start
 *   left-early = check_out earlier than slot end
 *   overtime   = check_out later than slot end
 * Records with no linked slot are counted as `unmatched` (they populate as the
 * kiosk links clock-ins going forward).
 */
import { fetchAttendanceRange } from '@/lib/shifts-attendance';
import { fetchEmployees } from '@/lib/shifts-odoo';
import { getOdoo } from '@/lib/odoo';
import { odooToDate, weekKeyToUtcRange } from '@/lib/shifts-time';

export interface PunctualityEmployee {
  employeeId: number;
  employeeName: string;
  lateCount: number;
  lateMins: number;
  earlyCount: number;
  earlyMins: number;
  overCount: number;
  overMins: number;
  matched: number;
}

export interface PunctualityResult {
  weekKey: string;
  employees: PunctualityEmployee[];
  unmatched: number;
}

export async function fetchWeekPunctuality(companyId: number, weekKey: string): Promise<PunctualityResult> {
  const { startOdoo, endOdoo } = weekKeyToUtcRange(weekKey);
  const [records, employees] = await Promise.all([
    fetchAttendanceRange(companyId, startOdoo, endOdoo),
    fetchEmployees(companyId),
  ]);
  const nameMap = new Map(employees.map(e => [e.id, e.name]));

  const slotIds = Array.from(
    new Set(records.map(r => r.planningSlotId).filter((v): v is number => v !== null)),
  );
  const slotMap = new Map<number, { start: string; end: string }>();
  if (slotIds.length > 0) {
    const rows = (await getOdoo().read('planning.slot', slotIds, [
      'start_datetime',
      'end_datetime',
    ])) as Record<string, unknown>[];
    for (const s of rows) {
      slotMap.set(s.id as number, {
        start: typeof s.start_datetime === 'string' ? s.start_datetime : '',
        end: typeof s.end_datetime === 'string' ? s.end_datetime : '',
      });
    }
  }

  const byEmp = new Map<number, PunctualityEmployee>();
  const get = (id: number): PunctualityEmployee => {
    let e = byEmp.get(id);
    if (!e) {
      e = {
        employeeId: id,
        employeeName: nameMap.get(id) ?? `Employee #${id}`,
        lateCount: 0,
        lateMins: 0,
        earlyCount: 0,
        earlyMins: 0,
        overCount: 0,
        overMins: 0,
        matched: 0,
      };
      byEmp.set(id, e);
    }
    return e;
  };

  let unmatched = 0;
  for (const r of records) {
    const slot = r.planningSlotId !== null ? slotMap.get(r.planningSlotId) : undefined;
    if (!slot || !slot.start) {
      unmatched++;
      continue;
    }
    const e = get(r.employeeId);
    e.matched++;
    const lateMin = Math.round((odooToDate(r.checkIn).getTime() - odooToDate(slot.start).getTime()) / 60000);
    if (lateMin > 0) {
      e.lateCount++;
      e.lateMins += lateMin;
    }
    if (r.checkOut && slot.end) {
      const diff = Math.round((odooToDate(r.checkOut).getTime() - odooToDate(slot.end).getTime()) / 60000);
      if (diff < 0) {
        e.earlyCount++;
        e.earlyMins += -diff;
      } else if (diff > 0) {
        e.overCount++;
        e.overMins += diff;
      }
    }
  }

  const employeesOut = Array.from(byEmp.values()).sort(
    (a, b) => b.lateMins + b.earlyMins - (a.lateMins + a.earlyMins) || a.employeeName.localeCompare(b.employeeName),
  );
  return { weekKey, employees: employeesOut, unmatched };
}

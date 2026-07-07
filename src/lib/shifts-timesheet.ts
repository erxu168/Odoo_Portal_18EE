/**
 * Shifts module — §17 MiLoG working-time records (per employee, per day).
 *
 * German law (§17 MiLoG, restaurant + Minijob) requires recording start, end and
 * duration of each employee's daily working time. The kiosk already captures this
 * into hr.attendance; this composes an auditable per-employee weekly timesheet the
 * manager can review and export (CSV).
 */
import { fetchAttendanceRange } from '@/lib/shifts-attendance';
import { fetchEmployees } from '@/lib/shifts-odoo';
import { berlinParts, weekKeyToUtcRange } from '@/lib/shifts-time';

export interface TimesheetEntry {
  /** Berlin calendar date "YYYY-MM-DD" of the clock-in */
  date: string;
  /** Odoo UTC-naive */
  checkIn: string;
  checkOut: string | null;
  /** Odoo-computed net worked hours (partial while still clocked in) */
  hours: number;
  /** true when there is no clock-out yet — the record is NOT audit-complete */
  incomplete: boolean;
}

export interface TimesheetEmployee {
  employeeId: number;
  employeeName: string;
  entries: TimesheetEntry[];
  totalHours: number;
  /** number of this employee's entries with no clock-out */
  incompleteCount: number;
}

export interface TimesheetResult {
  weekKey: string;
  employees: TimesheetEmployee[];
  /** total entries across the week with no clock-out (drives the §17 warning) */
  incompleteCount: number;
}

export async function fetchWeekTimesheet(companyId: number, weekKey: string): Promise<TimesheetResult> {
  const { startOdoo, endOdoo } = weekKeyToUtcRange(weekKey);
  const [records, employees] = await Promise.all([
    fetchAttendanceRange(companyId, startOdoo, endOdoo),
    fetchEmployees(companyId),
  ]);
  const nameMap = new Map(employees.map(e => [e.id, e.name]));

  const byEmp = new Map<number, TimesheetEmployee>();
  for (const r of records) {
    let te = byEmp.get(r.employeeId);
    if (!te) {
      te = {
        employeeId: r.employeeId,
        employeeName: nameMap.get(r.employeeId) ?? `Employee #${r.employeeId}`,
        entries: [],
        totalHours: 0,
        incompleteCount: 0,
      };
      byEmp.set(r.employeeId, te);
    }
    const incomplete = r.checkOut === null;
    te.entries.push({
      date: berlinParts(r.checkIn).date,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      hours: r.workedHours,
      incomplete,
    });
    te.totalHours += r.workedHours;
    if (incomplete) te.incompleteCount += 1;
  }

  const employeesOut = Array.from(byEmp.values())
    .map(e => ({ ...e, totalHours: Math.round(e.totalHours * 100) / 100 }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const incompleteCount = employeesOut.reduce((n, e) => n + e.incompleteCount, 0);

  return { weekKey, employees: employeesOut, incompleteCount };
}

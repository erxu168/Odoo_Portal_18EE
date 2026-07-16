/**
 * Shifts module — Odoo hr.attendance access layer (Time Attendance clock).
 *
 * Hard facts (introspected on Odoo 18 EE staging, uid=2):
 * - hr.attendance is INSTALLED and in active use (21k+ records). Fields used:
 *   employee_id (m2o), check_in / check_out ("YYYY-MM-DD HH:MM:SS" UTC-naive;
 *   check_out is false while the person is still clocked in), worked_hours
 *   (float), planning_slot_id (m2o planning.slot — links a clock-in to a shift).
 * - DSGVO: hr.attendance also carries in_latitude/longitude/in_ip_address. We do
 *   NOT read or rely on geolocation — presence is PIN-kiosk based only.
 * - Scope by employee_id.company_id (dotted domain) so we only see one restaurant.
 * - Times are Odoo UTC-naive; convert to Berlin wall clock in shifts-time.ts.
 */
import { getOdoo } from '@/lib/odoo';
import { durationHours } from '@/lib/shifts-time';

type OdooRow = Record<string, unknown>;

function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}
function m2oName(v: unknown): string {
  return Array.isArray(v) && typeof v[1] === 'string' ? v[1] : '';
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** A single clock-in/out pair from hr.attendance. */
export interface AttendanceRecord {
  id: number;
  employeeId: number;
  /** Odoo UTC-naive "YYYY-MM-DD HH:MM:SS" */
  checkIn: string;
  /** null while still clocked in */
  checkOut: string | null;
  /** Odoo-computed worked hours (present shows partial). */
  workedHours: number;
  /** the shift this clock-in is linked to, when set */
  planningSlotId: number | null;
}

function mapRow(r: OdooRow): AttendanceRecord {
  return {
    id: r.id as number,
    employeeId: m2oId(r.employee_id) ?? 0,
    checkIn: str(r.check_in),
    checkOut: r.check_out ? str(r.check_out) : null,
    workedHours: num(r.worked_hours),
    planningSlotId: m2oId(r.planning_slot_id),
  };
}

const ATT_FIELDS = ['employee_id', 'check_in', 'check_out', 'worked_hours', 'planning_slot_id'];

// -- Reads ------------------------------------------------------------------------

/** A live open clock-in (check_out still false) with the employee's name. */
export interface OpenAttendance {
  attendanceId: number;
  employeeId: number;
  /** employee display name, taken from the employee_id many2one (no extra query) */
  name: string;
  /** Odoo UTC-naive check-in */
  checkIn: string;
  workedHours: number;
}

/**
 * Employees currently clocked in for a company (open attendance = check_out false).
 * Returns employeeId → {name, check_in, worked_hours-so-far}. Latest open record
 * wins, so an employee with duplicate open records still appears once.
 */
export async function fetchOpenAttendance(companyId: number): Promise<Map<number, OpenAttendance>> {
  const rows = (await getOdoo().searchRead(
    'hr.attendance',
    [['employee_id.company_id', '=', companyId], ['check_out', '=', false]],
    ATT_FIELDS,
    { limit: 500, order: 'check_in desc' },
  )) as OdooRow[];
  const map = new Map<number, OpenAttendance>();
  for (const r of rows) {
    const eid = m2oId(r.employee_id);
    if (eid !== null && !map.has(eid)) {
      map.set(eid, {
        attendanceId: r.id as number,
        employeeId: eid,
        name: m2oName(r.employee_id),
        checkIn: str(r.check_in),
        workedHours: num(r.worked_hours),
      });
    }
  }
  return map;
}

/**
 * All attendance records whose check_in falls in [startUtc, endUtc) for a company.
 * Used for the punctuality record and the §17 MiLoG timesheet export.
 */
export async function fetchAttendanceRange(
  companyId: number,
  startUtc: string,
  endUtc: string,
): Promise<AttendanceRecord[]> {
  const rows = (await getOdoo().searchRead(
    'hr.attendance',
    [
      ['employee_id.company_id', '=', companyId],
      ['check_in', '>=', startUtc],
      ['check_in', '<', endUtc],
    ],
    ATT_FIELDS,
    { limit: 5000, order: 'check_in asc' },
  )) as OdooRow[];
  return rows.map(mapRow);
}

/** The employee's currently-open attendance id, or null when clocked out. */
export async function openAttendanceId(employeeId: number): Promise<number | null> {
  const rows = (await getOdoo().searchRead(
    'hr.attendance',
    [['employee_id', '=', employeeId], ['check_out', '=', false]],
    ['id'],
    { limit: 1, order: 'check_in desc' },
  )) as OdooRow[];
  return rows.length > 0 ? (rows[0].id as number) : null;
}

// -- Writes (kiosk clock in / out) ------------------------------------------------

/**
 * Clock IN: create an hr.attendance. `whenUtc` is Odoo UTC-naive. Optionally link
 * the shift (planning_slot_id) so lateness can be measured against the schedule.
 * Returns the new attendance id.
 */
export async function kioskClockIn(
  employeeId: number,
  whenUtc: string,
  planningSlotId?: number | null,
): Promise<number> {
  const vals: OdooRow = { employee_id: employeeId, check_in: whenUtc };
  if (planningSlotId) vals.planning_slot_id = planningSlotId;
  return (await getOdoo().create('hr.attendance', vals)) as number;
}

/** Clock OUT: write check_out on the given open attendance record. */
export async function kioskClockOut(attendanceId: number, whenUtc: string): Promise<void> {
  await getOdoo().write('hr.attendance', [attendanceId], { check_out: whenUtc });
}

/**
 * Record a finished break in Odoo, idempotently. Creates an hr.break
 * (krawings_attendance model; Odoo computes `duration`) for the work segment the
 * break followed, and stamps the segment's total_break_time. A segment has at most
 * one break after it, so we key on attendance_id: if an hr.break already exists for
 * it we skip the create (safe to retry after a partial failure or crash — no
 * duplicates). The total_break_time write is idempotent (same value). Times are
 * Odoo UTC-naive.
 */
export async function recordBreakOnce(
  employeeId: number,
  attendanceId: number,
  startUtc: string,
  endUtc: string,
): Promise<void> {
  const odoo = getOdoo();
  const existing = (await odoo.searchRead('hr.break', [['attendance_id', '=', attendanceId]], ['id'], {
    limit: 1,
  })) as OdooRow[];
  if (!existing.length) {
    await odoo.create('hr.break', {
      employee_id: employeeId,
      attendance_id: attendanceId,
      start_time: startUtc,
      end_time: endUtc,
    });
  }
  await odoo.write('hr.attendance', [attendanceId], { total_break_time: Math.max(0, durationHours(startUtc, endUtc)) });
}

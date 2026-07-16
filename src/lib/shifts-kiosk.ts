/**
 * Shifts module — tablet clock-in kiosk (no-login, device-based, PIN-gated).
 *
 * The kiosk lists a company's staff (those with a PIN), then a PIN punch clocks
 * them IN or OUT (auto-detected) by writing Odoo hr.attendance. Clock-ins are
 * linked to today's scheduled slot (planning_slot_id) so lateness matches later.
 * No geolocation (DSGVO) — device trust + PIN only.
 */
import { getOdoo } from '@/lib/odoo';
import { fetchEmployees, fetchWeekSlots } from '@/lib/shifts-odoo';
import {
  fetchOpenAttendance,
  kioskClockIn,
  kioskClockOut,
  openAttendanceId,
} from '@/lib/shifts-attendance';
import {
  berlinParts,
  currentWeekKey,
  fmtTimeRange,
  nowOdooUtc,
  odooToDate,
} from '@/lib/shifts-time';

export interface KioskStaff {
  employeeId: number;
  name: string;
  clockedIn: boolean;
  /** Whether this person has set a kiosk PIN yet. When false, tapping starts setup. */
  hasPin: boolean;
}

/**
 * All active staff of the company, each flagged with whether they have a PIN and
 * their live clocked-in state. Staff without a PIN still appear so they can set one
 * up at the tablet.
 */
export async function kioskStaffList(companyId: number, pinned: Set<number>): Promise<KioskStaff[]> {
  const [emps, open] = await Promise.all([fetchEmployees(companyId), fetchOpenAttendance(companyId)]);
  return emps
    .map(e => ({ employeeId: e.id, name: e.name, clockedIn: open.has(e.id), hasPin: pinned.has(e.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Look up an employee's display name + best email (work → private) for kiosk PIN
 * emails. Validates the employee belongs to the company. Returns null if unknown or
 * on another company; email is '' when none is on file.
 */
export async function kioskEmployeeContact(
  companyId: number,
  employeeId: number,
): Promise<{ name: string; email: string } | null> {
  const odoo = getOdoo();
  const rows = (await odoo.read('hr.employee', [employeeId], [
    'name',
    'company_id',
    'work_email',
    'private_email',
  ])) as Record<string, unknown>[];
  if (!rows.length) return null;
  const r = rows[0];
  const empCompany = Array.isArray(r.company_id) ? (r.company_id[0] as number) : null;
  if (empCompany !== companyId) return null;
  const email =
    (typeof r.work_email === 'string' && r.work_email) ||
    (typeof r.private_email === 'string' && r.private_email) ||
    '';
  const name = typeof r.name === 'string' ? r.name : 'Staff';
  return { name, email };
}

export type PunchNote = 'ontime' | 'late' | 'early' | 'overtime';

export interface PunchResult {
  ok: true;
  action: 'in' | 'out';
  name: string;
  /** HH:MM Berlin */
  at: string;
  note: PunchNote;
  /** minutes late / early / overtime (0 when on time) */
  mins: number;
  /** the matched shift, "16:00–22:00", when one was found */
  shift: string | null;
}

export interface PunchError {
  ok: false;
  error: string;
}

/**
 * Clock the employee IN or OUT (auto-detected from their open attendance).
 * Validates the employee belongs to the company. Returns a friendly result.
 */
export async function kioskPunch(companyId: number, employeeId: number): Promise<PunchResult | PunchError> {
  const odoo = getOdoo();
  const nowUtc = nowOdooUtc();
  const nowMs = odooToDate(nowUtc).getTime();
  const at = berlinParts(nowUtc).hhmm;

  // The employee read and the week-slot read are independent — fire them together to save a
  // round-trip. The open-attendance read is deliberately NOT batched here: it decides
  // clock-in vs clock-out, so we read it right before the write (below) to keep that
  // check→write window as tight as the original code did. Only PUBLISHED slots count for
  // punctuality — a draft rota entry must not become a commitment stamped onto attendance.
  const [emp, weekSlots] = await Promise.all([
    odoo.read('hr.employee', [employeeId], ['name', 'company_id']) as Promise<Record<string, unknown>[]>,
    fetchWeekSlots(companyId, currentWeekKey()),
  ]);

  if (!emp.length) return { ok: false, error: 'Unknown employee' };
  const empCompany = Array.isArray(emp[0].company_id) ? (emp[0].company_id[0] as number) : null;
  if (empCompany !== companyId) return { ok: false, error: 'This person is not on this company.' };
  const name = typeof emp[0].name === 'string' ? emp[0].name : 'Staff';

  const today = berlinParts(nowUtc).date;
  const mine = weekSlots.filter(s => {
    if (s.employeeId !== employeeId || s.state !== 'published') return false;
    const startMs = odooToDate(s.start).getTime();
    const endMs = odooToDate(s.end).getTime();
    return berlinParts(s.start).date === today || (startMs <= nowMs && nowMs < endMs);
  });
  const active = mine.find(s => {
    const startMs = odooToDate(s.start).getTime();
    const endMs = odooToDate(s.end).getTime();
    return startMs <= nowMs && nowMs < endMs;
  });
  const nearest = mine
    .slice()
    .sort(
      (a, b) =>
        Math.abs(odooToDate(a.start).getTime() - nowMs) - Math.abs(odooToDate(b.start).getTime() - nowMs),
    )[0];
  const slot = active ?? nearest ?? null;
  const shift = slot ? fmtTimeRange(slot.start, slot.end) : null;

  // Read open-attendance state immediately before the write to keep the check→write window
  // tight (a stale in/out decision could duplicate or wrongly close an attendance).
  const openId = await openAttendanceId(employeeId);

  if (openId) {
    // Clock OUT
    await kioskClockOut(openId, nowUtc);
    let note: PunchNote = 'ontime';
    let mins = 0;
    if (slot) {
      const endMs = odooToDate(slot.end).getTime();
      if (nowMs < endMs) {
        note = 'early';
        mins = Math.round((endMs - nowMs) / 60000);
      } else if (nowMs > endMs) {
        note = 'overtime';
        mins = Math.round((nowMs - endMs) / 60000);
      }
    }
    return { ok: true, action: 'out', name, at, note, mins, shift };
  }

  // Clock IN
  await kioskClockIn(employeeId, nowUtc, slot ? slot.id : null);
  let note: PunchNote = 'ontime';
  let mins = 0;
  if (slot) {
    const startMs = odooToDate(slot.start).getTime();
    if (nowMs > startMs) {
      note = 'late';
      mins = Math.round((nowMs - startMs) / 60000);
    }
  }
  return { ok: true, action: 'in', name, at, note, mins, shift };
}

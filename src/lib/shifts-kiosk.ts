/**
 * Shifts module — tablet clock-in kiosk (no-login, device-based, PIN-gated).
 *
 * A PIN punch performs one of four actions, auto-inferred from the person's state
 * unless the tablet asks for one explicitly:
 *   in     — start a shift (create hr.attendance check_in, link today's slot)
 *   break  — pause: clock OUT now and remember they're on break (unpaid gap)
 *   resume — back from break: clock IN again + record the break in Odoo (hr.break
 *            + the segment's total_break_time). The two work segments share the
 *            slot, so punctuality treats them as one shift.
 *   out    — end the shift (clock OUT; or, if on break, just close the break state)
 * No geolocation (DSGVO) — device trust + PIN only.
 */
import { getOdoo } from '@/lib/odoo';
import { fetchEmployees, fetchWeekSlots } from '@/lib/shifts-odoo';
import {
  fetchOpenAttendance,
  kioskClockIn,
  kioskClockOut,
  openAttendanceId,
  recordBreakOnce,
} from '@/lib/shifts-attendance';
import {
  clearOnBreak,
  getOnBreak,
  onBreakEmployeeIds,
  setOnBreak,
  ON_BREAK_STALE_MS,
} from '@/lib/shifts-db';
import {
  berlinParts,
  currentWeekKey,
  dateToOdoo,
  fmtTimeRange,
  nowOdooUtc,
  odooToDate,
} from '@/lib/shifts-time';

export interface KioskStaff {
  employeeId: number;
  name: string;
  clockedIn: boolean;
  /** clocked out but on a break (intends to return) */
  onBreak: boolean;
  /** Whether this person has set a kiosk PIN yet. When false, tapping starts setup. */
  hasPin: boolean;
}

/** Odoo UTC cutoff before which an on-break marker is treated as stale (abandoned). */
function staleBreakCutoff(): string {
  return dateToOdoo(new Date(Date.now() - ON_BREAK_STALE_MS));
}

/**
 * All active staff of the company, each flagged with PIN status and live state:
 * working (open attendance), on break (fresh break marker, not working), or off.
 */
export async function kioskStaffList(companyId: number, pinned: Set<number>): Promise<KioskStaff[]> {
  const [emps, open] = await Promise.all([fetchEmployees(companyId), fetchOpenAttendance(companyId)]);
  const onBreak = onBreakEmployeeIds(companyId, staleBreakCutoff());
  return emps
    .map(e => ({
      employeeId: e.id,
      name: e.name,
      clockedIn: open.has(e.id),
      onBreak: onBreak.has(e.id) && !open.has(e.id),
      hasPin: pinned.has(e.id),
    }))
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
export type KioskAction = 'in' | 'break' | 'out' | 'resume';

export interface PunchResult {
  ok: true;
  action: KioskAction;
  name: string;
  /** HH:MM Berlin */
  at: string;
  note: PunchNote;
  /** minutes late / early / overtime (0 when on time or for break) */
  mins: number;
  /** the matched shift, "16:00–22:00", when one was found */
  shift: string | null;
  /** for 'resume': how long the break lasted, in minutes */
  breakMins?: number;
}

export type KioskState = 'off' | 'working' | 'onbreak';

export interface PunchError {
  ok: false;
  error: string;
  /** the person's live state, so the tablet can refresh a stale grid */
  state?: KioskState;
}

interface TodaySlot {
  slotId: number | null;
  shift: string | null;
  startMs: number | null;
  endMs: number | null;
}

/** This employee's shift for today (active one preferred, else nearest), published only. */
async function findTodaySlot(companyId: number, employeeId: number, nowUtc: string): Promise<TodaySlot> {
  const nowMs = odooToDate(nowUtc).getTime();
  const weekSlots = await fetchWeekSlots(companyId, currentWeekKey());
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
    .sort((a, b) => Math.abs(odooToDate(a.start).getTime() - nowMs) - Math.abs(odooToDate(b.start).getTime() - nowMs))[0];
  const slot = active ?? nearest ?? null;
  return {
    slotId: slot ? slot.id : null,
    shift: slot ? fmtTimeRange(slot.start, slot.end) : null,
    startMs: slot ? odooToDate(slot.start).getTime() : null,
    endMs: slot ? odooToDate(slot.end).getTime() : null,
  };
}

function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}

/**
 * The planning slot the pre-break segment was linked to, so the resumed segment
 * reuses the SAME slot (both segments then count as one shift for punctuality).
 * Returns the segment's slot (null when it had none); only on a read error does it
 * fall back to a freshly-matched slot.
 */
async function preBreakSlotId(attendanceId: number, fallback: number | null): Promise<number | null> {
  try {
    const rows = (await getOdoo().read('hr.attendance', [attendanceId], ['planning_slot_id'])) as Record<
      string,
      unknown
    >[];
    // The segment resolved: use its slot (null when it had none). Only a read
    // *error* (not a since-deleted segment) falls back to a freshly-matched slot.
    return rows.length ? m2oId(rows[0].planning_slot_id) : null;
  } catch {
    return fallback;
  }
}

/**
 * Divergent state (clocked in AND an on-break marker) means a resume created the
 * new segment but didn't finish recording the break. Recover it — the break ended
 * when the new segment's check-in began — then clear the marker. Best-effort: the
 * marker is cleared even if the write fails, so a person can never get stuck.
 */
async function recoverInterruptedBreak(
  companyId: number,
  employeeId: number,
  openSegId: number,
  marker: { breakStartedAt: string; attendanceId: number },
): Promise<void> {
  if (marker.attendanceId !== openSegId) {
    try {
      const rows = (await getOdoo().read('hr.attendance', [openSegId], ['check_in'])) as Record<string, unknown>[];
      const endUtc = rows.length && typeof rows[0].check_in === 'string' ? (rows[0].check_in as string) : marker.breakStartedAt;
      await recordBreakOnce(employeeId, marker.attendanceId, marker.breakStartedAt, endUtc);
    } catch (err: unknown) {
      console.error('[kiosk] break recovery failed:', err instanceof Error ? err.message : err);
    }
  }
  clearOnBreak(companyId, employeeId);
}

const LEGAL_ACTIONS: Record<KioskState, KioskAction[]> = {
  off: ['in'],
  working: ['break', 'out'],
  onbreak: ['resume', 'out'],
};

/** Action inferred when the tablet sends none (legacy auto-toggle): NOT the same
 * as the first legal action — a working person's default is clock OUT, not break. */
const INFERRED_ACTION: Record<KioskState, KioskAction> = { off: 'in', working: 'out', onbreak: 'resume' };

/**
 * Perform a kiosk action for the employee. When `action` is omitted it's inferred
 * from live state; when supplied it's validated strictly against that state — an
 * illegal action returns an error carrying the live state so a stale tablet can
 * refresh. Break data is never dropped: a failed break write leaves the marker so
 * the next punch recovers it.
 */
export async function kioskPunch(
  companyId: number,
  employeeId: number,
  action?: KioskAction,
): Promise<PunchResult | PunchError> {
  const odoo = getOdoo();
  const emp = (await odoo.read('hr.employee', [employeeId], ['name', 'company_id'])) as Record<string, unknown>[];
  if (!emp.length) return { ok: false, error: 'Unknown employee' };
  const empCompany = Array.isArray(emp[0].company_id) ? (emp[0].company_id[0] as number) : null;
  if (empCompany !== companyId) return { ok: false, error: 'This person is not on this company.' };
  const name = typeof emp[0].name === 'string' ? emp[0].name : 'Staff';

  const nowUtc = nowOdooUtc();
  const nowMs = odooToDate(nowUtc).getTime();
  const at = berlinParts(nowUtc).hhmm;

  const openId = await openAttendanceId(employeeId);
  let onBreak = getOnBreak(companyId, employeeId);
  // Self-heal a stale break (person left without returning).
  if (onBreak && onBreak.breakStartedAt < staleBreakCutoff()) {
    clearOnBreak(companyId, employeeId);
    onBreak = null;
  }
  // Recover an interrupted resume (clocked in AND still marked on break).
  if (openId && onBreak) {
    await recoverInterruptedBreak(companyId, employeeId, openId, onBreak);
    onBreak = null;
  }

  const state: KioskState = openId ? 'working' : onBreak ? 'onbreak' : 'off';
  if (action && !LEGAL_ACTIONS[state].includes(action)) {
    const msg = state === 'working' ? 'Already clocked in.' : state === 'onbreak' ? 'On a break.' : 'Not clocked in.';
    return { ok: false, error: msg, state };
  }
  const effective: KioskAction = action ?? INFERRED_ACTION[state];

  const slot = await findTodaySlot(companyId, employeeId, nowUtc);

  switch (effective) {
    case 'in': {
      await kioskClockIn(employeeId, nowUtc, slot.slotId);
      let note: PunchNote = 'ontime';
      let mins = 0;
      if (slot.startMs !== null && nowMs > slot.startMs) {
        note = 'late';
        mins = Math.round((nowMs - slot.startMs) / 60000);
      }
      return { ok: true, action: 'in', name, at, note, mins, shift: slot.shift };
    }

    case 'break': {
      if (!openId) return { ok: false, error: 'Not clocked in.', state };
      await kioskClockOut(openId, nowUtc);
      setOnBreak(companyId, employeeId, nowUtc, openId);
      return { ok: true, action: 'break', name, at, note: 'ontime', mins: 0, shift: slot.shift };
    }

    case 'resume': {
      if (!onBreak) {
        // No marker (inferred/edge) — just clock in.
        await kioskClockIn(employeeId, nowUtc, slot.slotId);
        return { ok: true, action: 'in', name, at, note: 'ontime', mins: 0, shift: slot.shift };
      }
      const slotId = await preBreakSlotId(onBreak.attendanceId, slot.slotId);
      await kioskClockIn(employeeId, nowUtc, slotId);
      const startMs = odooToDate(onBreak.breakStartedAt).getTime();
      const breakMins = Math.max(0, Math.round((nowMs - startMs) / 60000));
      let recorded = false;
      try {
        await recordBreakOnce(employeeId, onBreak.attendanceId, onBreak.breakStartedAt, nowUtc);
        recorded = true;
      } catch (err: unknown) {
        // Leave the marker so the next punch recovers the break; the person is
        // already clocked back in, so don't block them.
        console.error('[kiosk] failed to record break:', err instanceof Error ? err.message : err);
      }
      if (recorded) clearOnBreak(companyId, employeeId);
      return { ok: true, action: 'resume', name, at, note: 'ontime', mins: 0, shift: slot.shift, breakMins };
    }

    case 'out': {
      if (openId) {
        await kioskClockOut(openId, nowUtc);
        clearOnBreak(companyId, employeeId); // defensive
        let note: PunchNote = 'ontime';
        let mins = 0;
        if (slot.endMs !== null) {
          if (nowMs < slot.endMs) {
            note = 'early';
            mins = Math.round((slot.endMs - nowMs) / 60000);
          } else if (nowMs > slot.endMs) {
            note = 'overtime';
            mins = Math.round((nowMs - slot.endMs) / 60000);
          }
        }
        return { ok: true, action: 'out', name, at, note, mins, shift: slot.shift };
      }
      // Ending the shift while on break — already clocked out, just close the state.
      clearOnBreak(companyId, employeeId);
      return { ok: true, action: 'out', name, at, note: 'ontime', mins: 0, shift: slot.shift };
    }
  }
}

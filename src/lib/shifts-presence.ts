/**
 * Shifts module — live presence for the manager "Right Now" board.
 *
 * Combines today's published planning.slots (who is scheduled) with open
 * hr.attendance records (who has clocked in) to derive a per-shift state:
 *   present  — clocked in right now
 *   late     — scheduled, not clocked in, now past start + grace, before end
 *   due      — scheduled, not clocked in, in the window but within grace
 *   upcoming — shift hasn't started yet
 *   done     — shift end time has passed
 * Anyone clocked in who is NOT on a published/assigned shift today is returned
 * separately as `unscheduledPresent`, so the board always answers "who is
 * physically here right now" even when the rota isn't published or maintained.
 * All time comparisons use absolute instants (UTC) so overnight shifts are safe.
 *
 * Known limitation: only the current ISO week's slots are fetched, so a shift
 * that started the previous Sunday and runs past Monday 00:00 is not matched to
 * its schedule during those early-Monday hours. The person is not lost — they
 * still appear under `unscheduledPresent` (clocked in) — only their shift link
 * and lateness are missed for that narrow window.
 */
import type { OpenAttendance } from '@/lib/shifts-attendance';
import { fetchOpenAttendance } from '@/lib/shifts-attendance';
import { fetchWeekSlots } from '@/lib/shifts-odoo';
import type { ShiftSlot } from '@/types/shifts';
import { berlinParts, currentWeekKey, nowOdooUtc, odooToDate } from '@/lib/shifts-time';

export type PresenceState = 'present' | 'late' | 'due' | 'upcoming' | 'done';

export interface PresenceRow {
  employeeId: number;
  employeeName: string;
  slotId: number;
  /** Odoo UTC-naive */
  start: string;
  end: string;
  state: PresenceState;
  /** clock-in time (Odoo UTC) when present, else null */
  checkIn: string | null;
  /** minutes past scheduled start, when late */
  minsLate: number;
}

/** Someone clocked in who has no published, assigned shift today. */
export interface UnscheduledPresent {
  employeeId: number;
  employeeName: string;
  /** clock-in time, Odoo UTC-naive */
  checkIn: string;
  /** true when the clock-in began before today (a likely forgotten clock-out) */
  sinceBeforeToday: boolean;
}

export interface PresenceResult {
  /** server "now" as Odoo UTC */
  now: string;
  graceMin: number;
  rows: PresenceRow[];
  lateCount: number;
  unscheduledPresent: UnscheduledPresent[];
}

const RANK: Record<PresenceState, number> = { late: 0, due: 1, present: 2, upcoming: 3, done: 4 };

/**
 * Pure presence computation — no Odoo access, so it is directly unit-testable.
 * `open` is keyed by employeeId with the newest open record per employee.
 */
export function buildPresence(
  slots: ShiftSlot[],
  open: Map<number, OpenAttendance>,
  nowUtc: string,
  graceMin: number,
): PresenceResult {
  const nowMs = odooToDate(nowUtc).getTime();
  const todayDate = berlinParts(nowUtc).date;

  const rows: PresenceRow[] = [];
  for (const s of slots) {
    if (s.employeeId === null || s.state !== 'published') continue;
    const startMs = odooToDate(s.start).getTime();
    const endMs = odooToDate(s.end).getTime();
    const active = startMs <= nowMs && nowMs < endMs;
    // Only shifts scheduled today (Berlin) or currently active (overnight edge).
    if (berlinParts(s.start).date !== todayDate && !active) continue;

    const att = open.get(s.employeeId);
    let state: PresenceState;
    let minsLate = 0;
    if (att) {
      state = 'present';
    } else if (nowMs >= endMs) {
      state = 'done';
    } else if (nowMs < startMs) {
      state = 'upcoming';
    } else if (nowMs >= startMs + graceMin * 60000) {
      state = 'late';
      minsLate = Math.round((nowMs - startMs) / 60000);
    } else {
      state = 'due';
    }

    rows.push({
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      slotId: s.id,
      start: s.start,
      end: s.end,
      state,
      checkIn: att?.checkIn ?? null,
      minsLate,
    });
  }

  rows.sort(
    (a, b) => RANK[a.state] - RANK[b.state] || odooToDate(a.start).getTime() - odooToDate(b.start).getTime(),
  );

  // Clocked in, but not represented by any scheduled row today → surface them.
  const scheduledEmpIds = new Set(rows.map(r => r.employeeId));
  const unscheduledPresent: UnscheduledPresent[] = [];
  for (const att of Array.from(open.values())) {
    if (scheduledEmpIds.has(att.employeeId)) continue;
    unscheduledPresent.push({
      employeeId: att.employeeId,
      employeeName: att.name || `Employee #${att.employeeId}`,
      checkIn: att.checkIn,
      sinceBeforeToday: berlinParts(att.checkIn).date !== todayDate,
    });
  }
  unscheduledPresent.sort((a, b) => odooToDate(a.checkIn).getTime() - odooToDate(b.checkIn).getTime());

  return { now: nowUtc, graceMin, rows, lateCount: rows.filter(r => r.state === 'late').length, unscheduledPresent };
}

export async function computePresence(companyId: number, graceMin: number): Promise<PresenceResult> {
  const nowUtc = nowOdooUtc();
  const [weekSlots, open] = await Promise.all([
    fetchWeekSlots(companyId, currentWeekKey()),
    fetchOpenAttendance(companyId),
  ]);
  return buildPresence(weekSlots, open, nowUtc, graceMin);
}

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
 * All time comparisons use absolute instants (UTC) so overnight shifts are safe.
 */
import { fetchWeekSlots } from '@/lib/shifts-odoo';
import { fetchOpenAttendance } from '@/lib/shifts-attendance';
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

export interface PresenceResult {
  /** server "now" as Odoo UTC */
  now: string;
  graceMin: number;
  rows: PresenceRow[];
  lateCount: number;
}

const RANK: Record<PresenceState, number> = { late: 0, due: 1, present: 2, upcoming: 3, done: 4 };

export async function computePresence(companyId: number, graceMin: number): Promise<PresenceResult> {
  const nowUtc = nowOdooUtc();
  const nowMs = odooToDate(nowUtc).getTime();
  const todayDate = berlinParts(nowUtc).date;

  const [weekSlots, open] = await Promise.all([
    fetchWeekSlots(companyId, currentWeekKey()),
    fetchOpenAttendance(companyId),
  ]);

  const rows: PresenceRow[] = [];
  for (const s of weekSlots) {
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
  return { now: nowUtc, graceMin, rows, lateCount: rows.filter(r => r.state === 'late').length };
}

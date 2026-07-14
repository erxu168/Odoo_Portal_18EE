/**
 * Shift patterns — PURE logic (no I/O), unit-tested.
 *
 * planSlotsForWeek expands a weekly pattern into concrete dated slots for one
 * ISO week; effectivePublishState computes the lazy deadline lock. Keeping these
 * pure lets us unit-test the tricky bits (weekday→date, lock) without a DB or
 * Odoo. All date/time reasoning defers to shifts-time helpers (Berlin/ISO week).
 */
import { weekKeyDays } from '@/lib/shifts-time';
import type { PublishRunState, ShiftPatternLine } from '@/types/shifts';

export interface PlannedSlot {
  /** "YYYY-MM-DD" Berlin calendar date */
  date: string;
  startHHMM: string;
  endHHMM: string;
  roleId: number | null;
  departmentId: number | null;
  minSkill: '2' | '3' | null;
}

/**
 * Expand a pattern's lines into dated slots (one per headcount) for a week.
 * weekday 1=Mon … 7=Sun maps onto the week's Monday…Sunday Berlin dates.
 * Out-of-range weekdays are skipped; headcount is clamped to 1..20.
 */
export function planSlotsForWeek(lines: ShiftPatternLine[], weekKey: string): PlannedSlot[] {
  const days = weekKeyDays(weekKey); // [Mon..Sun] "YYYY-MM-DD"
  const out: PlannedSlot[] = [];
  for (const l of lines) {
    if (l.weekday < 1 || l.weekday > 7) continue;
    const date = days[l.weekday - 1];
    const n = Math.max(1, Math.min(20, l.headcount || 1));
    for (let i = 0; i < n; i++) {
      out.push({
        date,
        startHHMM: l.startHHMM,
        endHHMM: l.endHHMM,
        roleId: l.roleId,
        departmentId: l.departmentId,
        minSkill: l.minSkill,
      });
    }
  }
  return out;
}

/**
 * Lazy lock: an 'open' run whose deadline has passed reads as 'locked'.
 * 'locked' and 'finalized' are terminal for this computation — never overridden.
 */
export function effectivePublishState(
  state: PublishRunState,
  selectDeadlineISO: string,
  nowISO: string,
): PublishRunState {
  if (state !== 'open') return state;
  return Date.parse(nowISO) > Date.parse(selectDeadlineISO) ? 'locked' : 'open';
}

/**
 * Shifts module — punctuality tallies (late-in / left-early / overtime).
 *
 * Each hr.attendance record is matched to a scheduled planning.slot, then clock
 * times are compared to the schedule:
 *   late-in    = check_in later than slot start
 *   left-early = check_out earlier than slot end
 *   overtime   = check_out later than slot end
 *
 * Match precedence (calculation-only — we never write an inferred link back to
 * Odoo, so this stays reversible and can't corrupt historical attendance):
 *   1. LINKED   — attendance.planning_slot_id, when it resolves to a slot of the
 *                 same company + employee (the kiosk stamps this at clock-in).
 *   2. FALLBACK — otherwise the employee's one published, assigned slot on the
 *                 same Berlin calendar day as the clock-in.
 *   3. AMBIGUOUS — several same-day slots could match; we refuse to guess.
 *   4. UNMATCHED — no candidate slot at all.
 * This makes lateness work even for records the kiosk never linked (e.g. the
 * rota was published/assigned after the clock-in).
 */
import type { AttendanceRecord } from '@/lib/shifts-attendance';
import { fetchAttendanceRange } from '@/lib/shifts-attendance';
import { fetchEmployees, fetchSlotsInRange, fetchWeekSlots } from '@/lib/shifts-odoo';
import type { ShiftSlot } from '@/types/shifts';
import { getOdoo } from '@/lib/odoo';
import {
  analyzeShiftBreak,
  ATTENDANCE_POLICY_DEFAULTS,
  BREAK_POLICY_DEFAULTS,
  breakPolicyFromSettings,
  overtimeMinutes,
  policyFromSettings,
  type AttendancePolicy,
  type BreakPolicy,
} from '@/lib/shifts-attendance-policy';
import { getShiftSettings } from '@/lib/shifts-db';
import { berlinParts, dateToOdoo, fmtTimeRange, odooToDate, weekKeyToUtcRange } from '@/lib/shifts-time';

export interface PunctualityEmployee {
  employeeId: number;
  employeeName: string;
  lateCount: number;
  lateMins: number;
  earlyCount: number;
  earlyMins: number;
  overCount: number;
  overMins: number;
  /** shifts (matched, closed) that fell short of the required rest break */
  missedBreakCount: number;
  /** total minutes of break shortfall across those shifts */
  breakShortfallMins: number;
  /** shifts matched (linked + fallback) for this employee */
  matched: number;
}

/**
 * One shift where the employee clocked out beyond the overtime grace. Keyed by
 * the clock-out hr.attendance id so a manager approval decision maps 1:1 to the
 * exact punch (no derived row to drift). Derived on-demand from attendance ×
 * slots — never stored — so it always reflects current data and stays reversible.
 */
export interface OvertimeEvent {
  /** hr.attendance id of the latest clock-out in the shift group. */
  attendanceId: number;
  employeeId: number;
  employeeName: string;
  /** Berlin calendar day of the scheduled shift (YYYY-MM-DD). */
  date: string;
  /** Human shift window, e.g. "09:00 – 17:00". */
  shift: string;
  /** Minutes worked beyond the scheduled end + grace. */
  overtimeMins: number;
}

export interface PunctualityResult {
  weekKey: string;
  employees: PunctualityEmployee[];
  /** clock-ins with no candidate shift at all */
  unmatched: number;
  /** clock-ins that could match several same-day shifts (not counted) */
  ambiguous: number;
  linkedMatched: number;
  fallbackMatched: number;
  /** Per-shift overtime beyond grace, one entry per clock-out that needs approval. */
  overtimeEvents: OvertimeEvent[];
}

/** Minimal slot shape the pure matcher needs. */
export interface PunctSlot {
  id: number;
  employeeId: number | null;
  /** Odoo UTC-naive */
  start: string;
  end: string;
}

/**
 * Pure punctuality tally — no Odoo access, so it is directly unit-testable.
 * `slotById` holds slots referenced by planning_slot_id (already company-checked);
 * `fallbackSlots` are the week's published, assigned slots.
 */
export function tallyPunctuality(
  weekKey: string,
  records: AttendanceRecord[],
  slotById: Map<number, PunctSlot>,
  fallbackSlots: PunctSlot[],
  nameOf: (id: number) => string,
  policy: AttendancePolicy = ATTENDANCE_POLICY_DEFAULTS,
  breakPolicy: BreakPolicy = BREAK_POLICY_DEFAULTS,
  /**
   * When set, only shifts whose SCHEDULED START falls in [startMs, endMs) are
   * tallied. Used with a padded attendance fetch so an overnight shift at a range
   * edge is completed from its out-of-window segments, while shifts that merely
   * touch the padding (their slot starts outside the range) are not counted.
   */
  slotStartRange?: { startMs: number; endMs: number },
): PunctualityResult {
  const byEmp = new Map<number, PunctualityEmployee>();
  const get = (id: number): PunctualityEmployee => {
    let e = byEmp.get(id);
    if (!e) {
      e = {
        employeeId: id,
        employeeName: nameOf(id),
        lateCount: 0,
        lateMins: 0,
        earlyCount: 0,
        earlyMins: 0,
        overCount: 0,
        overMins: 0,
        missedBreakCount: 0,
        breakShortfallMins: 0,
        matched: 0,
      };
      byEmp.set(id, e);
    }
    return e;
  };

  let unmatched = 0;
  let ambiguous = 0;

  // Resolve each punch to a shift, then group punches by shift so a shift split
  // across several clock-ins (e.g. a break) is judged ONCE on earliest check-in
  // and latest check-out — never double-counted as both "left early" and "late".
  interface Group {
    slot: PunctSlot;
    employeeId: number;
    earliestIn: string;
    latestOut: string | null;
    /** hr.attendance id of the record holding latestOut (for approval keying). */
    latestOutId: number | null;
    /** true while any segment of this shift is still clocked in (no check-out). */
    hasOpen: boolean;
    /** closed work segments as [inMs, outMs] instants (for break-rule analysis). */
    segments: Array<[number, number]>;
    linked: boolean;
  }
  const groups = new Map<string, Group>();

  for (const r of records) {
    // 1. Explicit kiosk link, validated against the record's employee (a slot
    //    since unassigned — employeeId null — keeps its original link).
    let slot: PunctSlot | undefined;
    let linked = false;
    if (r.planningSlotId !== null) {
      const s = slotById.get(r.planningSlotId);
      if (s && s.start && (s.employeeId === null || s.employeeId === r.employeeId)) {
        slot = s;
        linked = true;
      }
    }

    // 2. Fallback: the employee's single published slot on the same Berlin day.
    if (!slot) {
      const checkInDay = berlinParts(r.checkIn).date;
      const candidates = fallbackSlots.filter(
        s => s.employeeId === r.employeeId && s.start && berlinParts(s.start).date === checkInDay,
      );
      if (candidates.length === 1) {
        slot = candidates[0];
      } else if (candidates.length > 1) {
        ambiguous++;
        continue; // refuse to guess which shift
      }
    }

    if (!slot) {
      unmatched++;
      continue;
    }

    const seg: [number, number] | null = r.checkOut
      ? [odooToDate(r.checkIn).getTime(), odooToDate(r.checkOut).getTime()]
      : null;
    const key = `${r.employeeId}:${slot.id}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        slot,
        employeeId: r.employeeId,
        earliestIn: r.checkIn,
        latestOut: r.checkOut,
        latestOutId: r.checkOut ? r.id : null,
        hasOpen: r.checkOut === null,
        segments: seg ? [seg] : [],
        linked,
      });
    } else {
      if (seg) g.segments.push(seg);
      if (odooToDate(r.checkIn).getTime() < odooToDate(g.earliestIn).getTime()) g.earliestIn = r.checkIn;
      if (r.checkOut && (!g.latestOut || odooToDate(r.checkOut).getTime() > odooToDate(g.latestOut).getTime())) {
        g.latestOut = r.checkOut;
        g.latestOutId = r.id;
      }
      if (r.checkOut === null) g.hasOpen = true;
      if (linked) g.linked = true;
    }
  }

  let linkedMatched = 0;
  let fallbackMatched = 0;
  const overtimeEvents: OvertimeEvent[] = [];
  for (const g of Array.from(groups.values())) {
    // Ownership: only tally shifts whose scheduled start is inside the range
    // (skips groups formed from padded, out-of-range attendance).
    if (slotStartRange) {
      const startMs = odooToDate(g.slot.start).getTime();
      if (startMs < slotStartRange.startMs || startMs >= slotStartRange.endMs) continue;
    }
    if (g.linked) linkedMatched++;
    else fallbackMatched++;

    const e = get(g.employeeId);
    e.matched++;
    const lateMin = Math.round((odooToDate(g.earliestIn).getTime() - odooToDate(g.slot.start).getTime()) / 60000);
    if (lateMin > 0) {
      e.lateCount++;
      e.lateMins += lateMin;
    }
    // Only judge the end (left-early / overtime) once the WHOLE shift is closed.
    // While any segment is still open the final clock-out is unknown, so an early
    // or overtime verdict here would be provisional and could disagree with the
    // approvals queue (which likewise waits for a closed shift).
    if (g.latestOut && g.slot.end && !g.hasOpen) {
      const outMs = odooToDate(g.latestOut).getTime();
      const endMs = odooToDate(g.slot.end).getTime();
      if (outMs < endMs) {
        e.earlyCount++;
        e.earlyMins += Math.round((endMs - outMs) / 60000);
      } else {
        // Within the overtime grace after the end is a normal clock-out; only
        // beyond it counts as overtime.
        const over = overtimeMinutes(outMs, endMs, policy);
        if (over > 0) {
          e.overCount++;
          e.overMins += over;
          if (g.latestOutId !== null) {
            overtimeEvents.push({
              attendanceId: g.latestOutId,
              employeeId: g.employeeId,
              employeeName: nameOf(g.employeeId),
              date: berlinParts(g.slot.start).date,
              shift: g.slot.end ? fmtTimeRange(g.slot.start, g.slot.end) : berlinParts(g.slot.start).hhmm,
              overtimeMins: over,
            });
          }
        }
      }
    }

    // Missed break (ArbZG §4): a fully-closed shift whose qualifying rest breaks —
    // the gaps between segments that are long enough to count — fall short of what
    // the worked hours require. Open shifts are skipped (not yet final).
    if (!g.hasOpen && g.segments.length > 0) {
      const b = analyzeShiftBreak(g.segments, breakPolicy);
      if (b.missed) {
        e.missedBreakCount++;
        e.breakShortfallMins += b.shortfallMin;
      }
    }
  }

  const employees = Array.from(byEmp.values()).sort(
    (a, b) => b.lateMins + b.earlyMins - (a.lateMins + a.earlyMins) || a.employeeName.localeCompare(b.employeeName),
  );
  overtimeEvents.sort(
    (a, b) => b.date.localeCompare(a.date) || b.overtimeMins - a.overtimeMins || a.employeeName.localeCompare(b.employeeName),
  );
  return { weekKey, employees, unmatched, ambiguous, linkedMatched, fallbackMatched, overtimeEvents };
}

function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function fetchWeekPunctuality(companyId: number, weekKey: string): Promise<PunctualityResult> {
  const { startOdoo, endOdoo } = weekKeyToUtcRange(weekKey);
  const [records, slots] = await Promise.all([
    fetchAttendanceRange(companyId, startOdoo, endOdoo),
    fetchWeekSlots(companyId, weekKey),
  ]);
  return punctualityFromData(companyId, weekKey, records, slots);
}

/**
 * Punctuality over a whole ISO-week RANGE, computed in ONE pass. Fetching all
 * attendance + slots for the range and grouping once means a shift whose segments
 * straddle a week boundary (an overnight Sunday→Monday shift) stays a SINGLE group
 * — it can't be double-counted or judged on half its segments the way summing
 * per-week results would. Used by the compliance report.
 */
export async function fetchRangePunctuality(companyId: number, fromWeek: string, toWeek: string): Promise<PunctualityResult> {
  const startOdoo = weekKeyToUtcRange(fromWeek).startOdoo;
  const endOdoo = weekKeyToUtcRange(toWeek).endOdoo;
  const startMs = odooToDate(startOdoo).getTime();
  const endMs = odooToDate(endOdoo).getTime();
  const DAY = 86_400_000;
  // Pad the attendance fetch by a day each side so an overnight shift at a range
  // EDGE is completed from its out-of-window segments; the slot-start ownership
  // filter then keeps only shifts that actually start inside the range.
  const [records, slots] = await Promise.all([
    fetchAttendanceRange(companyId, dateToOdoo(new Date(startMs - DAY)), dateToOdoo(new Date(endMs + DAY))),
    fetchSlotsInRange(companyId, startOdoo, endOdoo),
  ]);
  return punctualityFromData(companyId, `${fromWeek}..${toWeek}`, records, slots, { startMs, endMs });
}

/**
 * Shared core: build the slot lookups from already-fetched records + slots and run
 * the tally. `key` is just the result label (week key or range key). Linked slots
 * outside the fetched window are read directly and company-checked.
 */
async function punctualityFromData(
  companyId: number,
  key: string,
  records: AttendanceRecord[],
  slots: ShiftSlot[],
  slotStartRange?: { startMs: number; endMs: number },
): Promise<PunctualityResult> {
  const employees = await fetchEmployees(companyId);
  const nameMap = new Map(employees.map(e => [e.id, e.name]));
  const nameOf = (id: number) => nameMap.get(id) ?? `Employee #${id}`;

  const fallbackSlots: PunctSlot[] = slots
    .filter(s => s.state === 'published' && s.employeeId !== null)
    .map(s => ({ id: s.id, employeeId: s.employeeId, start: s.start, end: s.end }));

  const slotById = new Map<number, PunctSlot>();
  for (const s of slots) slotById.set(s.id, { id: s.id, employeeId: s.employeeId, start: s.start, end: s.end });

  // A linked slot may fall outside the fetched window (overnight boundary) — read
  // those directly and validate the company before trusting them.
  const linkedIds = Array.from(
    new Set(records.map(r => r.planningSlotId).filter((v): v is number => v !== null)),
  ).filter(id => !slotById.has(id));
  if (linkedIds.length > 0) {
    const rows = (await getOdoo().read('planning.slot', linkedIds, [
      'start_datetime',
      'end_datetime',
      'employee_id',
      'company_id',
    ])) as Record<string, unknown>[];
    for (const s of rows) {
      if (m2oId(s.company_id) !== companyId) continue; // cross-company guard
      slotById.set(s.id as number, {
        id: s.id as number,
        employeeId: m2oId(s.employee_id),
        start: str(s.start_datetime),
        end: str(s.end_datetime),
      });
    }
  }

  const settings = getShiftSettings(companyId);
  return tallyPunctuality(
    key,
    records,
    slotById,
    fallbackSlots,
    nameOf,
    policyFromSettings(settings),
    breakPolicyFromSettings(settings),
    slotStartRange,
  );
}

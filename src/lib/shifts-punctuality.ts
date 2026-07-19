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
import { fetchEmployees, fetchWeekSlots } from '@/lib/shifts-odoo';
import { getOdoo } from '@/lib/odoo';
import { ATTENDANCE_POLICY_DEFAULTS, overtimeMinutes, policyFromSettings, type AttendancePolicy } from '@/lib/shifts-attendance-policy';
import { getShiftSettings } from '@/lib/shifts-db';
import { berlinParts, odooToDate, weekKeyToUtcRange } from '@/lib/shifts-time';

export interface PunctualityEmployee {
  employeeId: number;
  employeeName: string;
  lateCount: number;
  lateMins: number;
  earlyCount: number;
  earlyMins: number;
  overCount: number;
  overMins: number;
  /** shifts matched (linked + fallback) for this employee */
  matched: number;
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

    const key = `${r.employeeId}:${slot.id}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { slot, employeeId: r.employeeId, earliestIn: r.checkIn, latestOut: r.checkOut, linked });
    } else {
      if (odooToDate(r.checkIn).getTime() < odooToDate(g.earliestIn).getTime()) g.earliestIn = r.checkIn;
      if (r.checkOut && (!g.latestOut || odooToDate(r.checkOut).getTime() > odooToDate(g.latestOut).getTime())) {
        g.latestOut = r.checkOut;
      }
      if (linked) g.linked = true;
    }
  }

  let linkedMatched = 0;
  let fallbackMatched = 0;
  for (const g of Array.from(groups.values())) {
    if (g.linked) linkedMatched++;
    else fallbackMatched++;

    const e = get(g.employeeId);
    e.matched++;
    const lateMin = Math.round((odooToDate(g.earliestIn).getTime() - odooToDate(g.slot.start).getTime()) / 60000);
    if (lateMin > 0) {
      e.lateCount++;
      e.lateMins += lateMin;
    }
    if (g.latestOut && g.slot.end) {
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
        }
      }
    }
  }

  const employees = Array.from(byEmp.values()).sort(
    (a, b) => b.lateMins + b.earlyMins - (a.lateMins + a.earlyMins) || a.employeeName.localeCompare(b.employeeName),
  );
  return { weekKey, employees, unmatched, ambiguous, linkedMatched, fallbackMatched };
}

function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function fetchWeekPunctuality(companyId: number, weekKey: string): Promise<PunctualityResult> {
  const { startOdoo, endOdoo } = weekKeyToUtcRange(weekKey);
  const [records, employees, weekSlots] = await Promise.all([
    fetchAttendanceRange(companyId, startOdoo, endOdoo),
    fetchEmployees(companyId),
    fetchWeekSlots(companyId, weekKey),
  ]);
  const nameMap = new Map(employees.map(e => [e.id, e.name]));
  const nameOf = (id: number) => nameMap.get(id) ?? `Employee #${id}`;

  // Published, assigned slots this week drive the fallback (and are the in-week
  // linked slots too). They are already company-scoped by fetchWeekSlots.
  const fallbackSlots: PunctSlot[] = weekSlots
    .filter(s => s.state === 'published' && s.employeeId !== null)
    .map(s => ({ id: s.id, employeeId: s.employeeId, start: s.start, end: s.end }));

  const slotById = new Map<number, PunctSlot>();
  for (const s of weekSlots) slotById.set(s.id, { id: s.id, employeeId: s.employeeId, start: s.start, end: s.end });

  // A linked slot may fall outside this week (overnight boundary) — read those
  // directly and validate the company before trusting them.
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

  return tallyPunctuality(weekKey, records, slotById, fallbackSlots, nameOf, policyFromSettings(getShiftSettings(companyId)));
}

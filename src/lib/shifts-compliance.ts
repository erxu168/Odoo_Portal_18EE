/**
 * Shifts module — compliance report (Phase 4).
 *
 * A manager report over a range of ISO weeks that pulls together the attendance
 * signals already computed elsewhere — late arrivals, early leaves, overtime (with
 * its approval decisions), missed rest breaks (ArbZG §4) and rule acknowledgements
 * — into one per-employee view, plus a repeat-offender highlight.
 *
 * It REUSES `fetchWeekPunctuality` per week (the single source of the late / early
 * / overtime / missed-break logic) rather than re-deriving shifts, so the report
 * can never disagree with the Punctuality and Overtime screens. Everything is
 * derived on demand; nothing new is stored.
 */
import { fetchRangePunctuality } from '@/lib/shifts-punctuality';
import { attendanceAckStatsInRange, getShiftSettings, overtimeDecisions } from '@/lib/shifts-db';
import { breakPolicyFromSettings, type BreakPolicy } from '@/lib/shifts-attendance-policy';
import { offsetWeekKey, weekKeyDays, weekKeyToUtcRange } from '@/lib/shifts-time';

/** Hard cap on the range so one report can't fan out into unbounded Odoo reads. */
export const COMPLIANCE_MAX_WEEKS = 13;
/** An employee needs at least this many adverse events in the period to be a "repeat offender". */
export const REPEAT_OFFENDER_MIN = 3;

export interface ComplianceEmployee {
  employeeId: number;
  employeeName: string;
  matchedShifts: number;
  lateCount: number;
  lateMins: number;
  earlyCount: number;
  earlyMins: number;
  missedBreakCount: number;
  breakShortfallMins: number;
  overtimePendingCount: number;
  overtimePendingMins: number;
  overtimeApprovedCount: number;
  overtimeApprovedMins: number;
  overtimeRejectedCount: number;
  overtimeRejectedMins: number;
  ackCount: number;
  ackDistinctDays: number;
  /** late + early + missed-break: the "adverse events" that define a repeat offender */
  adverseCount: number;
}

export interface ComplianceReport {
  fromWeek: string;
  toWeek: string;
  weeks: string[];
  from: string; // Berlin date (inclusive)
  to: string; // Berlin date (inclusive)
  breakPolicy: BreakPolicy;
  employees: ComplianceEmployee[];
  repeatOffenders: ComplianceEmployee[];
  diagnostics: { unmatched: number; ambiguous: number };
}

/** ISO weeks from fromWeek to toWeek inclusive, capped. Empty when from is after to. */
export function weeksInRange(fromWeek: string, toWeek: string, cap = COMPLIANCE_MAX_WEEKS): string[] {
  const toStart = weekKeyToUtcRange(toWeek).startOdoo;
  if (weekKeyToUtcRange(fromWeek).startOdoo > toStart) return [];
  const weeks: string[] = [];
  let k = fromWeek;
  for (let i = 0; i < cap; i++) {
    weeks.push(k);
    if (k === toWeek) break;
    k = offsetWeekKey(k, 1);
    if (weekKeyToUtcRange(k).startOdoo > toStart) break;
  }
  return weeks;
}

function blank(employeeId: number, employeeName: string): ComplianceEmployee {
  return {
    employeeId,
    employeeName,
    matchedShifts: 0,
    lateCount: 0,
    lateMins: 0,
    earlyCount: 0,
    earlyMins: 0,
    missedBreakCount: 0,
    breakShortfallMins: 0,
    overtimePendingCount: 0,
    overtimePendingMins: 0,
    overtimeApprovedCount: 0,
    overtimeApprovedMins: 0,
    overtimeRejectedCount: 0,
    overtimeRejectedMins: 0,
    ackCount: 0,
    ackDistinctDays: 0,
    adverseCount: 0,
  };
}

export async function fetchComplianceReport(
  companyId: number,
  fromWeek: string,
  toWeek: string,
): Promise<ComplianceReport> {
  const weeks = weeksInRange(fromWeek, toWeek);
  if (weeks.length === 0) throw new Error('Empty week range (from is after to)');
  const settings = getShiftSettings(companyId);
  const breakPolicy = breakPolicyFromSettings(settings);

  const byEmp = new Map<number, ComplianceEmployee>();
  const get = (id: number, name: string) => {
    let e = byEmp.get(id);
    if (!e) {
      e = blank(id, name);
      byEmp.set(id, e);
    }
    return e;
  };

  // ONE pass over the whole range (not a sum of per-week results): a shift whose
  // segments straddle a week boundary stays a single group, so it can't be
  // double-counted or judged on partial data.
  const effectiveFrom = weeks[0];
  const effectiveTo = weeks[weeks.length - 1];
  const p = await fetchRangePunctuality(companyId, effectiveFrom, effectiveTo);
  const unmatched = p.unmatched;
  const ambiguous = p.ambiguous;

  for (const emp of p.employees) {
    const e = get(emp.employeeId, emp.employeeName);
    e.matchedShifts += emp.matched;
    e.lateCount += emp.lateCount;
    e.lateMins += emp.lateMins;
    e.earlyCount += emp.earlyCount;
    e.earlyMins += emp.earlyMins;
    e.missedBreakCount += emp.missedBreakCount;
    e.breakShortfallMins += emp.breakShortfallMins;
  }
  // Collect overtime events so their decisions can be joined once.
  const overtimeEvents = p.overtimeEvents;
  for (const ev of overtimeEvents) get(ev.employeeId, ev.employeeName);

  // Join overtime approval decisions once; a decision whose minutes changed since it
  // was made counts as pending again (mirrors the approvals screen's effectiveStatus).
  const decisions = overtimeDecisions(companyId, overtimeEvents.map(ev => ev.attendanceId));
  for (const ev of overtimeEvents) {
    const d = decisions.get(ev.attendanceId);
    const changed = !!d && d.status !== 'pending' && d.overtimeMins !== null && d.overtimeMins !== ev.overtimeMins;
    const status = !d || changed ? 'pending' : d.status;
    const e = get(ev.employeeId, ev.employeeName);
    if (status === 'approved') {
      e.overtimeApprovedCount++;
      e.overtimeApprovedMins += ev.overtimeMins;
    } else if (status === 'rejected') {
      e.overtimeRejectedCount++;
      e.overtimeRejectedMins += ev.overtimeMins;
    } else {
      e.overtimePendingCount++;
      e.overtimePendingMins += ev.overtimeMins;
    }
  }

  // Acknowledgements over the Berlin date range spanned by the (effective) weeks.
  const fromDate = weekKeyDays(effectiveFrom)[0];
  const toDate = weekKeyDays(effectiveTo)[6];
  const acks = attendanceAckStatsInRange(companyId, fromDate, toDate);
  for (const [empId, stat] of Array.from(acks.entries())) {
    // Only attach to employees already in the report (matched a shift / had overtime);
    // acknowledgements for people with no shifts in range are not a compliance signal here.
    const e = byEmp.get(empId);
    if (e) {
      e.ackCount = stat.count;
      e.ackDistinctDays = stat.distinctDays;
    }
  }

  const employees = Array.from(byEmp.values());
  for (const e of employees) e.adverseCount = e.lateCount + e.earlyCount + e.missedBreakCount;
  employees.sort((a, b) => b.adverseCount - a.adverseCount || a.employeeName.localeCompare(b.employeeName));

  const repeatOffenders = employees
    .filter(e => e.adverseCount >= REPEAT_OFFENDER_MIN)
    .slice(0, 20);

  return {
    // Report the EFFECTIVE range actually covered — if the request exceeded the
    // week cap, toWeek reflects where coverage really ends, not the request.
    fromWeek: effectiveFrom,
    toWeek: effectiveTo,
    weeks,
    from: fromDate,
    to: toDate,
    breakPolicy,
    employees,
    repeatOffenders,
    diagnostics: { unmatched, ambiguous },
  };
}

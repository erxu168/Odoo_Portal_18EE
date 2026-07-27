/**
 * Shifts module — overtime approval (Phase 3).
 *
 * Overtime EVENTS (a shift where someone clocked out past the grace) are derived
 * on-demand from attendance × schedule by the punctuality tally — never stored,
 * so they always reflect current data and stay reversible. This module joins each
 * derived event to the manager's stored DECISION (approve / reject / still
 * pending), keyed by the clock-out hr.attendance id, for the approvals screen.
 */
import { fetchWeekPunctuality, type OvertimeEvent } from '@/lib/shifts-punctuality';
import { overtimeDecisions, type OvertimeStatus } from '@/lib/shifts-db';

export interface OvertimeRow extends OvertimeEvent {
  /** the manager's stored decision (kept for display + audit) */
  status: OvertimeStatus;
  /**
   * The status that DRIVES the queue: same as `status`, except a decision whose
   * facts have since changed is forced back to 'pending' so it must be reviewed
   * again and is never silently counted as approved.
   */
  effectiveStatus: OvertimeStatus;
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** minutes recorded at decision time (may differ from the live overtimeMins) */
  decidedMins: number | null;
  /**
   * True when a decision was made but the live overtime no longer matches the
   * minutes it was decided on (the punch was later edited). Flags the manager to
   * review again — the safety net for deciding on facts that later changed.
   */
  changedSinceDecided: boolean;
}

export interface OvertimeWeek {
  weekKey: string;
  rows: OvertimeRow[];
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  /** total overtime minutes still awaiting a decision */
  pendingMins: number;
}

/** Derived overtime events for a week, each joined to its stored decision. */
export async function fetchOvertimeWeek(companyId: number, weekKey: string): Promise<OvertimeWeek> {
  const p = await fetchWeekPunctuality(companyId, weekKey);
  const ids = p.overtimeEvents.map(e => e.attendanceId);
  const decisions = overtimeDecisions(companyId, ids);

  const rows: OvertimeRow[] = p.overtimeEvents.map(e => {
    const d = decisions.get(e.attendanceId);
    const status: OvertimeStatus = d?.status ?? 'pending';
    const decidedMins = d?.overtimeMins ?? null;
    const changedSinceDecided =
      !!d && status !== 'pending' && decidedMins !== null && decidedMins !== e.overtimeMins;
    return {
      ...e,
      status,
      // A decision whose minutes changed is no longer trustworthy → re-review.
      effectiveStatus: changedSinceDecided ? 'pending' : status,
      reason: d?.reason ?? null,
      decidedByName: d?.decidedByName ?? null,
      decidedAt: d?.decidedAt ?? null,
      decidedMins,
      changedSinceDecided,
    };
  });

  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let pendingMins = 0;
  for (const r of rows) {
    if (r.effectiveStatus === 'approved') approvedCount++;
    else if (r.effectiveStatus === 'rejected') rejectedCount++;
    else {
      pendingCount++;
      pendingMins += r.overtimeMins;
    }
  }

  // Anything needing action first (true pending + changed), then most overtime, then newest.
  rows.sort(
    (a, b) =>
      Number(a.effectiveStatus !== 'pending') - Number(b.effectiveStatus !== 'pending') ||
      b.overtimeMins - a.overtimeMins ||
      b.date.localeCompare(a.date),
  );

  return { weekKey, rows, pendingCount, approvedCount, rejectedCount, pendingMins };
}

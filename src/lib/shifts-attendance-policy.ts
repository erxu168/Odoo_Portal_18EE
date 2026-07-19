/**
 * Shifts module — attendance policy (Phase 1: configurable grace + enforcement).
 *
 * Pure boundary rules shared by the kiosk punch, the punctuality tally and (later)
 * the presence board. No I/O, so it is directly unit-testable. All comparisons use
 * absolute millisecond instants; display minutes are rounded separately.
 *
 * Grace model (per company, from shift settings):
 *   earlyWindowMin   — minutes before shift start that clocking in is allowed.
 *                      Earlier than that is "too early" (refused when allowEarly is off).
 *   overtimeGraceMin — minutes after shift end that still count as a normal clock-out;
 *                      beyond it is overtime (needs approval).
 *   allowEarly       — when false, a too-early clock-in is refused, not just flagged.
 *
 * Per the brief there is NO late-arrival grace: any clock-in after the scheduled
 * start is late.
 */

export interface AttendancePolicy {
  earlyWindowMin: number;
  overtimeGraceMin: number;
  allowEarly: boolean;
}

export const ATTENDANCE_POLICY_DEFAULTS: AttendancePolicy = {
  earlyWindowMin: 10,
  overtimeGraceMin: 20,
  allowEarly: true,
};

/** Build the runtime policy from a company's shift settings. */
export function policyFromSettings(s: {
  attendanceEarlyWindowMin: number;
  attendanceOvertimeGraceMin: number;
  attendanceAllowEarly: boolean;
}): AttendancePolicy {
  return {
    earlyWindowMin: s.attendanceEarlyWindowMin,
    overtimeGraceMin: s.attendanceOvertimeGraceMin,
    allowEarly: s.attendanceAllowEarly,
  };
}

const MIN = 60_000;

/** Clock-in verdict. `earlyin` = before the allowed window; `late` = after start. */
export type ClockInNote = 'ontime' | 'earlyin' | 'late';
export interface ClockInVerdict {
  note: ClockInNote;
  /** minutes early (earlyin) or late (late); 0 when on time / within the early window */
  mins: number;
  /** true only when a too-early punch must be refused (allowEarly === false) */
  blocked: boolean;
  /** employee-facing message, or null */
  message: string | null;
}

/**
 * Classify a clock-IN. `startMs`/`startLabel` are null when the person has no
 * scheduled shift today — then it's always allowed, on time, no message.
 */
export function classifyClockIn(
  nowMs: number,
  startMs: number | null,
  startLabel: string | null,
  policy: AttendancePolicy,
): ClockInVerdict {
  if (startMs === null) return { note: 'ontime', mins: 0, blocked: false, message: null };

  const windowOpens = startMs - policy.earlyWindowMin * MIN;
  if (nowMs < windowOpens) {
    const mins = Math.round((startMs - nowMs) / MIN);
    const at = startLabel ? ` Your shift starts at ${startLabel}.` : '';
    if (!policy.allowEarly) {
      return { note: 'earlyin', mins, blocked: true,
        message: `It's too early to clock in.${at} Please come back closer to your start time.` };
    }
    return { note: 'earlyin', mins, blocked: false,
      message: `You've clocked in before your scheduled working hours.${at} Please begin work at your scheduled start time.` };
  }

  // From here clock-in is allowed. After the scheduled start = late (no arrival grace).
  // Compared at whole-minute granularity so it matches the punctuality report and a
  // few seconds past the minute doesn't read as "0 min late".
  const lateMins = Math.round((nowMs - startMs) / MIN);
  if (lateMins > 0) {
    return { note: 'late', mins: lateMins, blocked: false, message: null };
  }
  // At the start (or within the early window) — allowed and on time.
  return { note: 'ontime', mins: 0, blocked: false, message: null };
}

/** Clock-out verdict. `early` = before shift end; `overtime` = beyond the grace. */
export type ClockOutNote = 'ontime' | 'early' | 'overtime';
export interface ClockOutVerdict {
  note: ClockOutNote;
  /** minutes early (early) or minutes past scheduled end (overtime); 0 otherwise */
  mins: number;
  message: string | null;
}

/**
 * Classify a clock-OUT. `endMs` null when no scheduled shift → always on time.
 * Within the overtime grace after the end counts as a normal clock-out.
 */
export function classifyClockOut(
  nowMs: number,
  endMs: number | null,
  policy: AttendancePolicy,
): ClockOutVerdict {
  if (endMs === null) return { note: 'ontime', mins: 0, message: null };

  if (nowMs < endMs) {
    return { note: 'early', mins: Math.round((endMs - nowMs) / MIN), message: null };
  }
  if (nowMs > endMs + policy.overtimeGraceMin * MIN) {
    return { note: 'overtime', mins: Math.round((nowMs - endMs) / MIN),
      message: 'You have reached the end of your scheduled shift. Overtime requires prior approval.' };
  }
  // Within the grace window after the end — normal.
  return { note: 'ontime', mins: 0, message: null };
}

/**
 * Overtime minutes for a completed shift (batch reports). Returns the minutes past
 * the scheduled end when the clock-out is beyond the grace, else 0 (within grace or
 * early). `outMs`/`endMs` are absolute instants.
 */
export function overtimeMinutes(outMs: number, endMs: number, policy: AttendancePolicy): number {
  return outMs > endMs + policy.overtimeGraceMin * MIN ? Math.round((outMs - endMs) / MIN) : 0;
}

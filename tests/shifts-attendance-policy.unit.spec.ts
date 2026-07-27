import { test, expect } from '@playwright/test';
import {
  classifyClockIn,
  classifyClockOut,
  overtimeMinutes,
  analyzeShiftBreak,
  requiredBreakMinutes,
  BREAK_POLICY_DEFAULTS,
  ATTENDANCE_POLICY_DEFAULTS,
  type AttendancePolicy,
} from '../src/lib/shifts-attendance-policy';

// ============================= BREAK RULES (ArbZG §4) =======================
const bt = (h: number, m: number) => Date.UTC(2026, 6, 6, h, m); // instants; TZ irrelevant

test('break: required minutes follow strict >6h / >9h thresholds', () => {
  expect(requiredBreakMinutes(360)).toBe(0); // exactly 6h → none
  expect(requiredBreakMinutes(361)).toBe(30); // 6h01m → 30
  expect(requiredBreakMinutes(540)).toBe(30); // exactly 9h → still 30
  expect(requiredBreakMinutes(541)).toBe(45); // 9h01m → 45
});

test('break: a single 7h segment with no gap is a missed 30-min break', () => {
  const b = analyzeShiftBreak([[bt(9, 0), bt(16, 0)]]); // 7h worked, 0 break
  expect(b).toMatchObject({ workedMin: 420, qualifyingBreakMin: 0, requiredMin: 30, shortfallMin: 30, missed: true });
});

test('break: a 30-min gap satisfies the requirement for a 7h shift', () => {
  // 9:00-12:30 (3.5h) + 13:00-16:30 (3.5h) = 7h worked, 30-min qualifying gap
  const b = analyzeShiftBreak([[bt(9, 0), bt(12, 30)], [bt(13, 0), bt(16, 30)]]);
  expect(b.workedMin).toBe(420);
  expect(b.qualifyingBreakMin).toBe(30);
  expect(b.missed).toBe(false);
});

test('break: fragmented sub-15-min gaps do NOT count toward the requirement', () => {
  // three ~2.4h segments split by two 10-min gaps: 20 min of gaps, none qualifying
  const b = analyzeShiftBreak([
    [bt(9, 0), bt(11, 24)],
    [bt(11, 34), bt(13, 58)],
    [bt(14, 8), bt(16, 32)],
  ]);
  expect(b.qualifyingBreakMin).toBe(0); // neither 10-min gap qualifies
  expect(b.requiredMin).toBe(30);
  expect(b.missed).toBe(true);
});

test('break: >9h worked needs 45 min; a 30-min break still falls short', () => {
  // 08:00-13:00 (5h) + 13:30-18:00 (4.5h) = 9.5h worked, 30-min gap
  const b = analyzeShiftBreak([[bt(8, 0), bt(13, 0)], [bt(13, 30), bt(18, 0)]]);
  expect(b.workedMin).toBe(570); // 9.5h
  expect(b.requiredMin).toBe(45);
  expect(b.qualifyingBreakMin).toBe(30);
  expect(b).toMatchObject({ missed: true, shortfallMin: 15 });
});

test('break: a short shift (<=6h) never requires a break', () => {
  const b = analyzeShiftBreak([[bt(9, 0), bt(15, 0)]]); // exactly 6h
  expect(b.missed).toBe(false);
  expect(b.requiredMin).toBe(0);
});

test('break: just over 6h by seconds still requires a break (no rounding under the threshold)', () => {
  // 6h00m30s worked, no break. Rounding minutes would read 360 → none; exact ms → 30.
  const b = analyzeShiftBreak([[bt(9, 0), bt(15, 0) + 30_000]]);
  expect(b.requiredMin).toBe(30);
  expect(b.missed).toBe(true);
});

test('break: overlapping segments are merged (work not double-counted)', () => {
  const b = analyzeShiftBreak([[bt(9, 0), bt(13, 0)], [bt(12, 0), bt(16, 0)]]); // overlap → 09:00-16:00 = 7h
  expect(b.workedMin).toBe(420);
  expect(b.qualifyingBreakMin).toBe(0);
  expect(b.missed).toBe(true);
});

test('break: defaults are the ArbZG values (30 / 45 / 15)', () => {
  expect(BREAK_POLICY_DEFAULTS).toEqual({ after6hMin: 30, after9hMin: 45, minSegmentMin: 15 });
});


// Brief example: shift 09:00–17:00, early allowance 10 min, overtime grace 20 min.
const policy: AttendancePolicy = { earlyWindowMin: 10, overtimeGraceMin: 20, allowEarly: true };
const at = (h: number, m: number) => Date.UTC(2026, 6, 6, h, m); // instants; TZ irrelevant (pure ms)
const START = at(9, 0);
const END = at(17, 0);

test('clock-in before the window (08:49) is flagged too-early but allowed by default', () => {
  const v = classifyClockIn(at(8, 49), START, '09:00', policy);
  expect(v.note).toBe('earlyin');
  expect(v.blocked).toBe(false);
  expect(v.mins).toBe(11);
  expect(v.message).toContain('before your scheduled working hours');
  expect(v.message).toContain('09:00');
});

test('clock-in before the window is BLOCKED when allowEarly is off', () => {
  const v = classifyClockIn(at(8, 49), START, '09:00', { ...policy, allowEarly: false });
  expect(v.note).toBe('earlyin');
  expect(v.blocked).toBe(true);
  expect(v.message).toContain('too early');
});

test('clock-in exactly when the window opens (08:50) is on time and silent', () => {
  const v = classifyClockIn(at(8, 50), START, '09:00', policy);
  expect(v.note).toBe('ontime');
  expect(v.mins).toBe(0);
  expect(v.blocked).toBe(false);
  expect(v.message).toBeNull();
});

test('clock-in at exactly the scheduled start (09:00) is on time, not late', () => {
  expect(classifyClockIn(START, START, '09:00', policy).note).toBe('ontime');
});

test('clock-in after start (09:15) is late with no arrival grace', () => {
  const v = classifyClockIn(at(9, 15), START, '09:00', policy);
  expect(v.note).toBe('late');
  expect(v.mins).toBe(15);
  expect(v.blocked).toBe(false);
});

test('a few seconds past start rounds to on time (whole-minute granularity)', () => {
  expect(classifyClockIn(START + 20_000, START, '09:00', policy).note).toBe('ontime'); // 20s → on time
  expect(classifyClockIn(START + 3 * 60_000, START, '09:00', policy)).toMatchObject({ note: 'late', mins: 3 });
});

test('clock-in with no scheduled shift is always allowed and on time', () => {
  const v = classifyClockIn(at(3, 0), null, null, policy);
  expect(v).toEqual({ note: 'ontime', mins: 0, blocked: false, message: null });
});

test('clock-out before shift end (16:45) is left-early', () => {
  const v = classifyClockOut(at(16, 45), END, policy);
  expect(v.note).toBe('early');
  expect(v.mins).toBe(15);
});

test('clock-out within the overtime grace (17:15) is accepted normally', () => {
  const v = classifyClockOut(at(17, 15), END, policy);
  expect(v.note).toBe('ontime');
  expect(v.mins).toBe(0);
  expect(v.message).toBeNull();
});

test('clock-out exactly at the grace boundary (17:20) is still normal', () => {
  expect(classifyClockOut(at(17, 20), END, policy).note).toBe('ontime');
});

test('clock-out beyond the grace (17:30) is overtime needing approval', () => {
  const v = classifyClockOut(at(17, 30), END, policy);
  expect(v.note).toBe('overtime');
  expect(v.mins).toBe(30);
  expect(v.message).toContain('Overtime requires prior approval');
});

test('overtimeMinutes: 0 within grace or early, minutes past end beyond grace', () => {
  expect(overtimeMinutes(at(17, 15), END, policy)).toBe(0); // within grace
  expect(overtimeMinutes(at(16, 45), END, policy)).toBe(0); // early
  expect(overtimeMinutes(at(17, 30), END, policy)).toBe(30); // overtime
});

test('defaults match the brief examples (10 / 20 / allow early)', () => {
  expect(ATTENDANCE_POLICY_DEFAULTS).toEqual({ earlyWindowMin: 10, overtimeGraceMin: 20, allowEarly: true });
});

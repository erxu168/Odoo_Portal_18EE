import { test, expect } from '@playwright/test';
import {
  classifyClockIn,
  classifyClockOut,
  overtimeMinutes,
  ATTENDANCE_POLICY_DEFAULTS,
  type AttendancePolicy,
} from '../src/lib/shifts-attendance-policy';

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

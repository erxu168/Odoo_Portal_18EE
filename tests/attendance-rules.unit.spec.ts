import { test, expect } from '@playwright/test';
import {
  needsAcknowledgement,
  rulesHash,
  DEFAULT_ATTENDANCE_RULES,
  RULES_CADENCES,
} from '../src/lib/attendance-rules';

test('every_clockin always needs acknowledgement', () => {
  expect(needsAcknowledgement('every_clockin', { ackedToday: true, ackedCurrentHash: true })).toBe(true);
  expect(needsAcknowledgement('every_clockin', { ackedToday: false, ackedCurrentHash: false })).toBe(true);
});

test('daily needs acknowledgement only when not acknowledged today', () => {
  expect(needsAcknowledgement('daily', { ackedToday: false, ackedCurrentHash: true })).toBe(true);
  expect(needsAcknowledgement('daily', { ackedToday: true, ackedCurrentHash: false })).toBe(false);
});

test('on_change needs acknowledgement only when the current text was not acknowledged', () => {
  expect(needsAcknowledgement('on_change', { ackedToday: true, ackedCurrentHash: false })).toBe(true);
  expect(needsAcknowledgement('on_change', { ackedToday: false, ackedCurrentHash: true })).toBe(false);
});

test('rulesHash is stable across whitespace but changes with content', () => {
  const a = rulesHash('Be on time.\n\nRecord all breaks.');
  const b = rulesHash('Be on time.   Record all breaks.'); // same words, different whitespace
  const c = rulesHash('Be on time. Record all breaks. And do not be late.');
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a).toMatch(/^[0-9a-f]{16}$/);
});

test('the default rules text covers the brief points and has no build-breaking apostrophes', () => {
  expect(DEFAULT_ATTENDANCE_RULES).toContain('Overtime must be approved');
  expect(DEFAULT_ATTENDANCE_RULES).toContain('smoking breaks');
  expect(DEFAULT_ATTENDANCE_RULES).not.toContain("'"); // straight apostrophes block the Next build
  expect(RULES_CADENCES).toEqual(['every_clockin', 'daily', 'on_change']);
});

import { test, expect } from '@playwright/test';
import { weeksInRange, COMPLIANCE_MAX_WEEKS } from '../src/lib/shifts-compliance';

test('weeksInRange: inclusive range within a year', () => {
  expect(weeksInRange('2026-W28', '2026-W31')).toEqual(['2026-W28', '2026-W29', '2026-W30', '2026-W31']);
});

test('weeksInRange: a single week', () => {
  expect(weeksInRange('2026-W30', '2026-W30')).toEqual(['2026-W30']);
});

test('weeksInRange: from after to returns empty', () => {
  expect(weeksInRange('2026-W31', '2026-W28')).toEqual([]);
});

test('weeksInRange: crosses the year boundary', () => {
  const r = weeksInRange('2025-W52', '2026-W02');
  expect(r[0]).toBe('2025-W52');
  expect(r[r.length - 1]).toBe('2026-W02');
  expect(r.length).toBeGreaterThanOrEqual(3);
});

test('weeksInRange: caps at COMPLIANCE_MAX_WEEKS', () => {
  const r = weeksInRange('2026-W01', '2026-W52');
  expect(r.length).toBe(COMPLIANCE_MAX_WEEKS);
  expect(r[0]).toBe('2026-W01');
});

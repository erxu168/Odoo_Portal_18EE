import { test, expect } from '@playwright/test';
import { nextDateStr, isDueNow, groupByEmployee, DUE_WINDOW_MS } from '../src/lib/shift-day-before-reminder';

test('nextDateStr rolls over month and year boundaries', () => {
  expect(nextDateStr('2026-07-20')).toBe('2026-07-21');
  expect(nextDateStr('2026-07-31')).toBe('2026-08-01');
  expect(nextDateStr('2026-12-31')).toBe('2027-01-01');
});

test('isDueNow fires only within the one-hour send window', () => {
  const at = 1_000_000_000_000; // scheduled instant
  expect(isDueNow(at, at)).toBe(true); // exactly at send time
  expect(isDueNow(at, at + DUE_WINDOW_MS - 1)).toBe(true); // 59:59 later
  expect(isDueNow(at, at - 1)).toBe(false); // one ms early
  expect(isDueNow(at, at + DUE_WINDOW_MS)).toBe(false); // exactly one hour later → next window
  expect(isDueNow(at, at + 5 * DUE_WINDOW_MS)).toBe(false); // hours later → no backfill
});

test('groupByEmployee groups per person and sorts each group by start', () => {
  const items = [
    { employeeId: 7, startMs: 300, roleName: 'Grill' },
    { employeeId: 3, startMs: 200, roleName: 'Front' },
    { employeeId: 7, startMs: 100, roleName: 'Open' },
  ];
  const g = groupByEmployee(items);
  expect(Array.from(g.keys()).sort()).toEqual([3, 7]);
  expect(g.get(7)!.map(i => i.startMs)).toEqual([100, 300]); // sorted
  expect(g.get(3)!.map(i => i.roleName)).toEqual(['Front']);
});

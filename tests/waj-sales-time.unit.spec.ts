import { test, expect } from '@playwright/test';
import {
  berlinParts, berlinDayOf, berlinMidnightMs, utcStr, dayShift, mondayOf,
  prevMonthFirst, labelDay, labelMonth, weekdayLabel, dayOfMonthLabel, computeBounds,
} from '../src/lib/waj-sales-time';

// 2026-07-14 is a Tuesday (CEST, UTC+2); 2026-01-14 is a Wednesday (CET, UTC+1).

test('berlinParts converts UTC to Berlin with the right DST offset', () => {
  const summer = berlinParts('2026-07-14 13:30:00'); // +2 -> 15:30 Berlin
  expect(summer).toEqual({ day: '2026-07-14', hour: 15, dow: 1 });
  const winter = berlinParts('2026-01-14 13:30:00'); // +1 -> 14:30 Berlin
  expect(winter).toEqual({ day: '2026-01-14', hour: 14, dow: 2 });
});

test('berlinParts handles the midnight boundary (the fixed-+1 bug)', () => {
  // 22:30 UTC in July is 00:30 the NEXT day in Berlin (+2).
  const p = berlinParts('2026-07-13 22:30:00');
  expect(p.day).toBe('2026-07-14');
  expect(p.hour).toBe(0);
});

test('berlinMidnightMs is DST-aware', () => {
  expect(berlinMidnightMs('2026-07-14')).toBe(Date.UTC(2026, 6, 13, 22, 0, 0)); // +2
  expect(berlinMidnightMs('2026-01-14')).toBe(Date.UTC(2026, 0, 13, 23, 0, 0)); // +1
});

test('berlinMidnightMs is correct on the two DST-transition days', () => {
  // Spring forward 2026-03-29 (jump at 02:00): midnight is still +1.
  expect(berlinMidnightMs('2026-03-29')).toBe(Date.UTC(2026, 2, 28, 23, 0, 0));
  expect(berlinDayOf(berlinMidnightMs('2026-03-29'))).toBe('2026-03-29');
  // Fall back 2026-10-25 (jump at 03:00): midnight is still +2.
  expect(berlinMidnightMs('2026-10-25')).toBe(Date.UTC(2026, 9, 24, 22, 0, 0));
  expect(berlinDayOf(berlinMidnightMs('2026-10-25'))).toBe('2026-10-25');
});

test('month prev-period never spills past the previous month end', () => {
  // Mar 30 → February only has 28 days; prev window must cap at Mar 1 (Feb end).
  const now = Date.UTC(2026, 2, 30, 10, 0, 0);
  const b = computeBounds('month', now);
  expect(b.startDay).toBe('2026-03-01');
  expect(b.prevStartMs).toBe(berlinMidnightMs('2026-02-01'));
  expect(b.prevEndMs).toBe(berlinMidnightMs('2026-03-01')); // capped at end of Feb
});

test('round-trips a Berlin midnight back to the same day', () => {
  const ms = berlinMidnightMs('2026-07-14');
  expect(berlinDayOf(ms)).toBe('2026-07-14');
  expect(berlinDayOf(ms + 12 * 3600 * 1000)).toBe('2026-07-14');
});

test('date string helpers', () => {
  expect(utcStr(Date.UTC(2026, 6, 13, 22, 0, 0))).toBe('2026-07-13 22:00:00');
  expect(dayShift('2026-07-01', -1)).toBe('2026-06-30');
  expect(dayShift('2026-07-14', -7)).toBe('2026-07-07');
  expect(mondayOf('2026-07-14')).toBe('2026-07-13'); // Tue -> Mon
  expect(mondayOf('2026-07-13')).toBe('2026-07-13'); // Mon -> Mon
  expect(mondayOf('2026-07-19')).toBe('2026-07-13'); // Sun -> that week's Mon
  expect(prevMonthFirst('2026-07-01')).toBe('2026-06-01');
  expect(prevMonthFirst('2026-01-01')).toBe('2025-12-01');
});

test('labels', () => {
  expect(labelDay('2026-07-14')).toBe('Tue 14 Jul');
  expect(labelMonth('2026-07-01')).toBe('Jul 2026');
  expect(weekdayLabel('2026-07-14')).toBe('Tue');
  expect(dayOfMonthLabel('2026-07-14')).toBe('14');
});

test('computeBounds: today', () => {
  const now = Date.UTC(2026, 6, 14, 13, 30, 0); // 15:30 Berlin, Tue
  const b = computeBounds('today', now);
  expect(b.gran).toBe('hour');
  expect(b.startDay).toBe('2026-07-14');
  expect(b.curStartMs).toBe(Date.UTC(2026, 6, 13, 22, 0, 0));
  expect(b.curEndMs).toBe(now);
  expect(b.prevStartMs).toBe(Date.UTC(2026, 6, 6, 22, 0, 0)); // last Tue midnight
  expect(b.prevEndMs).toBe(now - 7 * 86400000);
  expect(b.cmp).toContain('last Tue');
  expect(b.sub).toBe('Today · Tue 14 Jul');
});

test('computeBounds: week starts Monday, prev = 7 days back', () => {
  const now = Date.UTC(2026, 6, 14, 13, 30, 0);
  const b = computeBounds('week', now);
  expect(b.gran).toBe('day');
  expect(b.startDay).toBe('2026-07-13');
  expect(b.prevStartMs).toBe(berlinMidnightMs('2026-07-06'));
  expect(b.cmp).toBe('vs last week');
});

test('computeBounds: month = 1st..now, prev = same-length window from prev month', () => {
  const now = Date.UTC(2026, 6, 14, 13, 30, 0);
  const b = computeBounds('month', now);
  expect(b.startDay).toBe('2026-07-01');
  expect(b.curStartMs).toBe(berlinMidnightMs('2026-07-01'));
  expect(b.prevStartMs).toBe(berlinMidnightMs('2026-06-01'));
  expect(b.prevEndMs - b.prevStartMs).toBe(b.curEndMs - b.curStartMs); // equal elapsed
  expect(b.sub).toBe('This month · Jul 2026');
});

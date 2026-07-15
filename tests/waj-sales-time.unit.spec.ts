import { test, expect } from '@playwright/test';
import {
  berlinParts, berlinDayOf, berlinMidnightMs, utcStr, dayShift, mondayOf,
  prevMonthFirst, monthFirst, firstOfNextMonth, shiftYearDay,
  shiftDays, shiftMonths, shiftYears, classifyCategory, projectMonth, daysInMonthOf,
  labelDay, labelMonth, weekdayLabel, dayOfMonthLabel, computeBounds,
} from '../src/lib/waj-sales-time';

// 2026-07-14 is a Tuesday (CEST, UTC+2); 2026-01-14 is a Wednesday (CET, UTC+1).
const NOW = Date.UTC(2026, 6, 14, 13, 30, 0); // 15:30 Berlin, Tue 14 Jul 2026
const TODAY = '2026-07-14';

test('berlinParts converts UTC to Berlin with the right DST offset', () => {
  expect(berlinParts('2026-07-14 13:30:00')).toEqual({ day: '2026-07-14', hour: 15, dow: 1 });
  expect(berlinParts('2026-01-14 13:30:00')).toEqual({ day: '2026-01-14', hour: 14, dow: 2 });
});

test('berlinParts handles the midnight boundary (the fixed-+1 bug)', () => {
  const p = berlinParts('2026-07-13 22:30:00'); // 00:30 next day in Berlin (+2)
  expect(p.day).toBe('2026-07-14');
  expect(p.hour).toBe(0);
});

test('berlinMidnightMs is DST-aware', () => {
  expect(berlinMidnightMs('2026-07-14')).toBe(Date.UTC(2026, 6, 13, 22, 0, 0)); // +2
  expect(berlinMidnightMs('2026-01-14')).toBe(Date.UTC(2026, 0, 13, 23, 0, 0)); // +1
});

test('berlinMidnightMs is correct on the two DST-transition days', () => {
  expect(berlinMidnightMs('2026-03-29')).toBe(Date.UTC(2026, 2, 28, 23, 0, 0)); // spring forward
  expect(berlinDayOf(berlinMidnightMs('2026-03-29'))).toBe('2026-03-29');
  expect(berlinMidnightMs('2026-10-25')).toBe(Date.UTC(2026, 9, 24, 22, 0, 0)); // fall back
  expect(berlinDayOf(berlinMidnightMs('2026-10-25'))).toBe('2026-10-25');
});

test('date string helpers', () => {
  expect(utcStr(Date.UTC(2026, 6, 13, 22, 0, 0))).toBe('2026-07-13 22:00:00');
  expect(dayShift('2026-07-01', -1)).toBe('2026-06-30');
  expect(dayShift('2026-07-14', -7)).toBe('2026-07-07');
  expect(mondayOf('2026-07-14')).toBe('2026-07-13'); // Tue -> Mon
  expect(mondayOf('2026-07-19')).toBe('2026-07-13'); // Sun -> that week's Mon
  expect(prevMonthFirst('2026-01-01')).toBe('2025-12-01');
  expect(monthFirst('2026-07-14')).toBe('2026-07-01');
  expect(firstOfNextMonth('2026-12-01')).toBe('2027-01-01');
  expect(shiftYearDay('2026-07-14', -1)).toBe('2025-07-14');
  expect(shiftYearDay('2024-02-29', 1)).toBe('2025-02-28'); // clamp leap day
});

test('wall-clock shifts are DST- and leap-safe', () => {
  // -1 day across the spring-forward day keeps midnight.
  expect(shiftDays(berlinMidnightMs('2026-03-30'), -1)).toBe(berlinMidnightMs('2026-03-29'));
  // -1 month from Mar 30 clamps to Feb 28 (never spills to March).
  expect(berlinDayOf(shiftMonths(berlinMidnightMs('2026-03-30'), -1))).toBe('2026-02-28');
  // +1 year from a leap day clamps to Feb 28.
  expect(berlinDayOf(shiftYears(berlinMidnightMs('2024-02-29'), 1))).toBe('2025-02-28');
  // -364 days keeps the weekday (52 weeks) for week-over-year comparisons.
  expect(shiftDays(berlinMidnightMs('2026-07-13'), -364)).toBe(berlinMidnightMs('2025-07-14'));
});

test('classifyCategory: group + rough food-cost %', () => {
  expect(classifyCategory('WAJ Drinks')).toEqual({ group: 'drink', costPct: 45 });
  expect(classifyCategory('Soft Drinks')).toEqual({ group: 'drink', costPct: 45 });
  expect(classifyCategory('Sauces')).toEqual({ group: 'sauce', costPct: 15 });
  expect(classifyCategory('WAJ Sides')).toEqual({ group: 'side', costPct: 25 });
  expect(classifyCategory('Burgers').costPct).toBe(35);
  expect(classifyCategory('Patties').costPct).toBe(32);
  expect(classifyCategory('WAJ Grill').costPct).toBe(38);
  expect(classifyCategory('Signature Jerk').costPct).toBe(38);
  expect(classifyCategory('Mystery Box')).toEqual({ group: 'food', costPct: 33 });
});

test('projectMonth extrapolates to month-end; daysInMonthOf', () => {
  expect(projectMonth(1000, 10, 30)).toBe(3000);
  expect(projectMonth(0, 0, 30)).toBe(0);
  expect(daysInMonthOf('2026-02-01')).toBe(28);
  expect(daysInMonthOf('2024-02-01')).toBe(29);
  expect(daysInMonthOf('2026-07-15')).toBe(31);
});

test('labels', () => {
  expect(labelDay('2026-07-14')).toBe('Tue 14 Jul');
  expect(labelMonth('2026-07-01')).toBe('Jul 2026');
  expect(weekdayLabel('2026-07-14')).toBe('Tue');
  expect(dayOfMonthLabel('2026-07-14')).toBe('14');
});

test('bounds: today', () => {
  const b = computeBounds('today', TODAY, NOW);
  expect(b.gran).toBe('hour');
  expect(b.curStartMs).toBe(Date.UTC(2026, 6, 13, 22, 0, 0));
  expect(b.curEndMs).toBe(NOW);
  expect(b.prevStartMs).toBe(Date.UTC(2026, 6, 6, 22, 0, 0)); // last Tue midnight
  expect(b.prevEndMs).toBe(NOW - 7 * 86400000);
  expect(b.prevLabel).toContain('last Tue');
  expect(b.yoyStartMs).toBe(berlinMidnightMs('2025-07-14'));
  expect(b.yoyLabel).toBe('vs last year');
  expect(b.sub).toBe('Today · Tue 14 Jul');
});

test('bounds: week (Monday start, weekly labels, prev + YoY)', () => {
  const b = computeBounds('week', TODAY, NOW);
  expect(b.gran).toBe('day');
  expect(b.weekly).toBe(true);
  expect(b.curStartMs).toBe(berlinMidnightMs('2026-07-13'));
  expect(b.prevStartMs).toBe(berlinMidnightMs('2026-07-06'));
  expect(b.prevLabel).toBe('vs last week');
  expect(b.yoyLabel).toBe('vs same week last year');
  expect(b.sub).toBe('Week of Mon 13 Jul');
});

test('bounds: month (prev + YoY, day granularity)', () => {
  const b = computeBounds('month', TODAY, NOW);
  expect(b.gran).toBe('day');
  expect(b.weekly).toBe(false);
  expect(b.curStartMs).toBe(berlinMidnightMs('2026-07-01'));
  expect(b.prevStartMs).toBe(berlinMidnightMs('2026-06-01'));
  expect(b.yoyStartMs).toBe(berlinMidnightMs('2025-07-01'));
  expect(b.yoyLabel).toBe('vs same month last year');
  expect(b.sub).toBe('Jul 2026');
});

test('bounds: month prev-period clamps into a shorter previous month', () => {
  // Mar 30 → February has 28 days, so the prev endpoint clamps to Feb 28 (never March).
  const b = computeBounds('month', '2026-03-30', Date.UTC(2026, 2, 30, 10, 0, 0));
  expect(b.curStartMs).toBe(berlinMidnightMs('2026-03-01'));
  expect(b.prevStartMs).toBe(berlinMidnightMs('2026-02-01'));
  expect(berlinDayOf(b.prevEndMs)).toBe('2026-02-28');       // clamped, stays in February
  expect(b.prevEndMs).toBeLessThan(berlinMidnightMs('2026-03-01'));
});

test('bounds: YTD (Jan 1 -> now, month granularity, YoY only)', () => {
  const b = computeBounds('ytd', TODAY, NOW);
  expect(b.gran).toBe('month');
  expect(b.curStartMs).toBe(berlinMidnightMs('2026-01-01'));
  expect(b.curEndMs).toBe(NOW);
  expect(b.prevLabel).toBe('');
  expect(b.yoyStartMs).toBe(berlinMidnightMs('2025-01-01'));
  expect(b.yoyLabel).toBe('vs last year (YTD)');
  expect(b.sub).toBe('2026 · year to date');
});

test('bounds: current year is partial; a past year is the full year', () => {
  const cur = computeBounds('year', TODAY, NOW);
  expect(cur.curStartMs).toBe(berlinMidnightMs('2026-01-01'));
  expect(cur.curEndMs).toBe(NOW); // partial
  expect(cur.yoyLabel).toBe('vs 2025');
  expect(cur.sub).toBe('2026');

  const past = computeBounds('year', '2025-07-14', NOW);
  expect(past.curStartMs).toBe(berlinMidnightMs('2025-01-01'));
  expect(past.curEndMs).toBe(berlinMidnightMs('2026-01-01')); // full year
  expect(past.yoyStartMs).toBe(berlinMidnightMs('2024-01-01'));
});

test('bounds: a future anchor is clamped to today', () => {
  const b = computeBounds('month', '2027-01-01', NOW);
  expect(b.anchorDay).toBe(TODAY);
  expect(b.sub).toBe('Jul 2026');
});

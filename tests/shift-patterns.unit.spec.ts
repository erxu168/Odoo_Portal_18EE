import { test, expect } from '@playwright/test';
import { planSlotsForWeek, effectivePublishState } from '../src/lib/shifts-patterns';
import type { ShiftPatternLine } from '../src/types/shifts';

const line = (o: Partial<ShiftPatternLine>): ShiftPatternLine => ({
  weekday: 1,
  startHHMM: '09:00',
  endHHMM: '17:00',
  roleId: null,
  departmentId: null,
  headcount: 1,
  minSkill: null,
  ...o,
});

test('planSlotsForWeek expands headcount and maps weekday to the right Berlin date', () => {
  // 2026-W28 → Monday 2026-07-06 … Sunday 2026-07-12
  const out = planSlotsForWeek([line({ weekday: 5, headcount: 2, roleId: 7 })], '2026-W28');
  expect(out.length).toBe(2);
  expect(out[0].date).toBe('2026-07-10'); // Friday
  expect(out[0].roleId).toBe(7);
  expect(out[0].startHHMM).toBe('09:00');
});

test('planSlotsForWeek keeps per-line department and minSkill', () => {
  const out = planSlotsForWeek([line({ weekday: 1, departmentId: 3, minSkill: '3' })], '2026-W28');
  expect(out[0].date).toBe('2026-07-06'); // Monday
  expect(out[0].departmentId).toBe(3);
  expect(out[0].minSkill).toBe('3');
});

test('effectivePublishState locks an open run past its deadline', () => {
  expect(
    effectivePublishState('open', '2026-07-08T18:00:00.000Z', '2026-07-08T19:00:00.000Z'),
  ).toBe('locked');
  expect(
    effectivePublishState('open', '2026-07-08T20:00:00.000Z', '2026-07-08T19:00:00.000Z'),
  ).toBe('open');
});

test('effectivePublishState never overrides finalized', () => {
  expect(
    effectivePublishState('finalized', '2020-01-01T00:00:00.000Z', '2026-07-08T19:00:00.000Z'),
  ).toBe('finalized');
});

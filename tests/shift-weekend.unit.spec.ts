import { test, expect } from '@playwright/test';
import { computeWeekendGate, isWeekendDow } from '../src/lib/shifts-weekend';
import type { WeekendSlotLite, CohortEmp } from '../src/lib/shifts-weekend';

const slot = (o: Partial<WeekendSlotLite> & { id: number }): WeekendSlotLite => ({
  roleId: null,
  minSkill: null,
  resourceId: null,
  ...o,
});
const emp = (o: Partial<CohortEmp> & { id: number }): CohortEmp => ({
  resourceId: o.id * 100,
  skill: '2',
  roleIds: [],
  ...o,
});

test('isWeekendDow: Fri/Sat/Sun only', () => {
  expect([1, 2, 3, 4].map(isWeekendDow)).toEqual([false, false, false, false]);
  expect([5, 6, 7].map(isWeekendDow)).toEqual([true, true, true]);
});

test('10 weekend slots ÷ 5 eligible servers → quota 2, remaining 2', () => {
  const slots = Array.from({ length: 10 }, (_, i) => slot({ id: i + 1 }));
  const cohort = Array.from({ length: 5 }, (_, i) => emp({ id: i + 1 }));
  const g = computeWeekendGate(slots, cohort, cohort[0]);
  expect(g.inCohort).toBe(true);
  expect(g.required).toBe(2);
  expect(g.done).toBe(0);
  expect(g.remaining).toBe(2);
  expect(g.gateOpen).toBe(false);
});

test('after claiming my 2 weekend slots the gate opens', () => {
  const me = emp({ id: 1 });
  const slots = [
    slot({ id: 1, resourceId: me.resourceId }),
    slot({ id: 2, resourceId: me.resourceId }),
    ...Array.from({ length: 8 }, (_, i) => slot({ id: i + 3 })),
  ];
  const cohort = Array.from({ length: 5 }, (_, i) => emp({ id: i + 1 }));
  const g = computeWeekendGate(slots, cohort, me);
  expect(g.done).toBe(2);
  expect(g.remaining).toBe(0);
  expect(g.gateOpen).toBe(true);
});

test('9 slots ÷ 5 servers → quota ceil(1.8)=2', () => {
  const slots = Array.from({ length: 9 }, (_, i) => slot({ id: i + 1 }));
  const cohort = Array.from({ length: 5 }, (_, i) => emp({ id: i + 1 }));
  expect(computeWeekendGate(slots, cohort, cohort[0]).required).toBe(2);
});

test('all weekend slots taken → gate opens for everyone even if remaining>0', () => {
  const others = emp({ id: 2 });
  // 10 slots, all assigned to others; me has 0 → remaining would be 2 but none are available
  const slots = Array.from({ length: 10 }, (_, i) => slot({ id: i + 1, resourceId: others.resourceId }));
  const cohort = Array.from({ length: 5 }, (_, i) => emp({ id: i + 1 }));
  const g = computeWeekendGate(slots, cohort, cohort[0]);
  expect(g.weekendSlotsAvailable).toBe(0);
  expect(g.gateOpen).toBe(true);
});

test('staff eligible for NO weekend slot is not in cohort and gate is open', () => {
  // every weekend slot needs role 9; me can only do role 1
  const slots = Array.from({ length: 6 }, (_, i) => slot({ id: i + 1, roleId: 9 }));
  const me = emp({ id: 1, roleIds: [1] });
  const cohort = [me, emp({ id: 2, roleIds: [9] }), emp({ id: 3, roleIds: [9] })];
  const g = computeWeekendGate(slots, cohort, me);
  expect(g.inCohort).toBe(false);
  expect(g.required).toBe(0);
  expect(g.gateOpen).toBe(true);
});

test('quota is capped by how many weekend slots the person is eligible for', () => {
  // 12 slots but me eligible for only 1 (role 1); others cover the rest (role 9)
  const slots = [
    slot({ id: 1, roleId: 1 }),
    ...Array.from({ length: 11 }, (_, i) => slot({ id: i + 2, roleId: 9 })),
  ];
  const me = emp({ id: 1, roleIds: [1] });
  const cohort = [me, emp({ id: 2, roleIds: [9] })];
  const g = computeWeekendGate(slots, cohort, me);
  expect(g.required).toBe(1); // min(ceil(12/2)=6, eligible=1)
});

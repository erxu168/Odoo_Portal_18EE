import { test, expect } from '@playwright/test';
import {
  addDaysISO,
  targetDatesFor,
  dupKey,
  planDuplicates,
  type DupSpec,
} from '../src/lib/shifts-duplicate';

const spec = (o: Partial<DupSpec> = {}): DupSpec => ({
  date: '2026-07-13', // Monday
  start: '09:00',
  end: '17:00',
  roleId: null,
  deptId: null,
  minSkill: null,
  note: '',
  ...o,
});

test('addDaysISO rolls over month and year boundaries', () => {
  expect(addDaysISO('2026-07-13', 7)).toBe('2026-07-20');
  expect(addDaysISO('2026-07-30', 7)).toBe('2026-08-06');
  expect(addDaysISO('2026-12-30', 7)).toBe('2027-01-06');
});

test('targetDatesFor once → same weekday one week later', () => {
  expect(targetDatesFor('2026-07-13', 'once', null, 8)).toEqual(['2026-07-20']);
});

test('targetDatesFor weekly_until is inclusive of the end date', () => {
  expect(targetDatesFor('2026-07-13', 'weekly_until', '2026-08-10', 8)).toEqual([
    '2026-07-20',
    '2026-07-27',
    '2026-08-03',
    '2026-08-10',
  ]);
});

test('targetDatesFor weekly_until stops before a mid-week end (partial final week)', () => {
  // Mon source; end on a Wednesday → the Monday occurrence past it is excluded.
  expect(targetDatesFor('2026-07-13', 'weekly_until', '2026-08-05', 8)).toEqual([
    '2026-07-20',
    '2026-07-27',
    '2026-08-03',
  ]);
});

test('targetDatesFor weekly_until caps at maxWeeks', () => {
  const out = targetDatesFor('2026-07-13', 'weekly_until', '2030-01-01', 8);
  expect(out.length).toBe(8);
  expect(out[7]).toBe('2026-09-07'); // 13 Jul + 8 weeks
});

test('dupKey uses only assignment-stable fields (date/time/role/note), not dept/skill', () => {
  // Department + skill are excluded so assigning a copy (which clears skill and
  // can swap in a derived department) does not change its identity.
  const base = dupKey(spec({ roleId: 5, deptId: 3, minSkill: '2', note: 'Opening' }));
  expect(base).toBe('2026-07-13|09:00|17:00|5|Opening');
  // Same shift after assignment clears skill + changes department → same key.
  expect(dupKey(spec({ roleId: 5, deptId: 9, minSkill: null, note: 'Opening' }))).toBe(base);
});

test('planDuplicates once creates the +7 copy when the target week is empty', () => {
  const { toCreate, skipped } = planDuplicates({
    sources: [spec()],
    existing: [],
    mode: 'once',
    until: null,
    maxWeeks: 8,
  });
  expect(skipped).toBe(0);
  expect(toCreate).toHaveLength(1);
  expect(toCreate[0].date).toBe('2026-07-20');
});

test('planDuplicates skips a copy that already exists in the target week', () => {
  const { toCreate, skipped } = planDuplicates({
    sources: [spec()],
    existing: [spec({ date: '2026-07-20' })], // already there
    mode: 'once',
    until: null,
    maxWeeks: 8,
  });
  expect(toCreate).toHaveLength(0);
  expect(skipped).toBe(1);
});

test('planDuplicates skips an already-copied shift even after it was assigned (dept/skill changed)', () => {
  // Codex High #1: assigning a copy clears its skill and can swap in the
  // assignee's department. The dedup must still recognise it as the same shift.
  const { toCreate, skipped } = planDuplicates({
    sources: [spec({ deptId: 3, minSkill: '2' })], // Mon, Kitchen, Level 2+
    existing: [spec({ date: '2026-07-20', deptId: 7, minSkill: null })], // the copy, now assigned
    mode: 'once',
    until: null,
    maxWeeks: 8,
  });
  expect(toCreate).toHaveLength(0);
  expect(skipped).toBe(1);
});

test('planDuplicates is count-aware: two sources, one existing → make one, skip one', () => {
  const { toCreate, skipped } = planDuplicates({
    sources: [spec(), spec()], // two identical shifts that day
    existing: [spec({ date: '2026-07-20' })], // only one already copied
    mode: 'once',
    until: null,
    maxWeeks: 8,
  });
  expect(toCreate).toHaveLength(1);
  expect(skipped).toBe(1);
});

test('planDuplicates weekly_until fans a day across the horizon', () => {
  const { toCreate } = planDuplicates({
    sources: [spec()],
    existing: [],
    mode: 'weekly_until',
    until: '2026-08-10',
    maxWeeks: 8,
  });
  expect(toCreate.map(t => t.date)).toEqual(['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10']);
});

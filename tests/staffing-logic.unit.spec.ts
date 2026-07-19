import { test, expect } from '@playwright/test';
import {
  mergeTaskSeeds, addDaysISO, computeDueDate, dueState, reminderStageDue, isPromotion,
} from '../src/lib/staffing-logic';
import type { TemplateTaskSeed } from '../src/types/staffing';

function seed(p: Partial<TemplateTaskSeed>): TemplateTaskSeed {
  return {
    audience: 'business', title: 't', description: null, sequence: 0,
    responsible_type: 'employee_manager', responsible_user_id: null,
    due_offset_days: null, reminder: false, source: 'base', ...p,
  };
}

test('mergeTaskSeeds keeps base before addon and re-sequences per audience', () => {
  const base = [seed({ title: 'B1', audience: 'business', sequence: 5, source: 'base' }),
                seed({ title: 'E1', audience: 'employee', sequence: 9, source: 'base' })];
  const addon = [seed({ title: 'B2', audience: 'business', sequence: 0, source: 'team' })];
  const merged = mergeTaskSeeds(base, addon);
  const biz = merged.filter(s => s.audience === 'business');
  expect(biz.map(s => s.title)).toEqual(['B1', 'B2']);
  expect(biz.map(s => s.sequence)).toEqual([0, 1]);
  expect(merged.find(s => s.title === 'B2')!.source).toBe('team');
});

test('addDaysISO adds calendar days across month/year boundaries', () => {
  expect(addDaysISO('2026-07-19', 7)).toBe('2026-07-26');
  expect(addDaysISO('2026-02-27', 2)).toBe('2026-03-01'); // 2026 not leap
  expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
});

test('computeDueDate is null when offset is null', () => {
  expect(computeDueDate('2026-07-19', null)).toBeNull();
  expect(computeDueDate('2026-07-19', 3)).toBe('2026-07-22');
});

test('dueState classifies pending tasks', () => {
  expect(dueState({ status: 'done', dueDate: '2026-07-01', todayISO: '2026-07-19' })).toBe('done');
  expect(dueState({ status: 'pending', dueDate: null, todayISO: '2026-07-19' })).toBe('none');
  expect(dueState({ status: 'pending', dueDate: '2026-07-10', todayISO: '2026-07-19' })).toBe('overdue');
  expect(dueState({ status: 'pending', dueDate: '2026-07-21', todayISO: '2026-07-19' })).toBe('due_soon');
  expect(dueState({ status: 'pending', dueDate: '2026-08-30', todayISO: '2026-07-19' })).toBe('upcoming');
});

test('reminderStageDue escalates lead -> due-day -> overdue', () => {
  expect(reminderStageDue('2026-07-25', '2026-07-19')).toBe(0); // >3 days away
  expect(reminderStageDue('2026-07-22', '2026-07-19')).toBe(1); // within lead window
  expect(reminderStageDue('2026-07-19', '2026-07-19')).toBe(2); // due today
  expect(reminderStageDue('2026-07-17', '2026-07-19')).toBe(3); // overdue
  expect(reminderStageDue(null, '2026-07-19')).toBe(0);
});

test('isPromotion only for upward numeric level changes', () => {
  expect(isPromotion('1', '2')).toBe(true);
  expect(isPromotion('1', '3')).toBe(true);
  expect(isPromotion('2', '3')).toBe(true);
  expect(isPromotion('2', '1')).toBe(false); // demotion
  expect(isPromotion('2', '2')).toBe(false); // unchanged
  expect(isPromotion(null, '2')).toBe(false); // unknown old level
  expect(isPromotion('1', null)).toBe(false);
});

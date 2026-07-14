import { test, expect } from '@playwright/test';
import { nextReminderStage, confirmByMs, REMINDER_LEAD_MS, type ReminderStage } from '../src/lib/shift-confirm';

const H = 3600e3;
const start = 3 * 24 * H; // shift 3 days out
const base = { confirmByHours: 24, sentStages: [] as ReminderStage[], confirmed: false };

test('confirmed -> null', () => {
  expect(nextReminderStage({ ...base, startMs: start, nowMs: 0, confirmed: true })).toBeNull();
});

test('unconfirmed, >7 days out, nothing sent -> null (no burst on enable)', () => {
  expect(nextReminderStage({ ...base, startMs: 10 * 24 * H, nowMs: 0 })).toBeNull();
});

test('within 7 days, nothing sent -> first', () => {
  expect(nextReminderStage({ ...base, startMs: start, nowMs: 0 })).toBe('first');
});

test('first already sent, not near cutoff -> null', () => {
  expect(nextReminderStage({ ...base, startMs: start, nowMs: 0, sentStages: ['first'] })).toBeNull();
});

test('first sent, within REMINDER_LEAD of cutoff -> reminder', () => {
  const now = confirmByMs(start, 24) - REMINDER_LEAD_MS + 1;
  expect(nextReminderStage({ ...base, startMs: start, nowMs: now, sentStages: ['first'] })).toBe('reminder');
});

test('past cutoff, overdue not sent -> overdue_mgr', () => {
  const now = confirmByMs(start, 24) + 1;
  expect(nextReminderStage({ ...base, startMs: start, nowMs: now, sentStages: ['first', 'reminder'] })).toBe('overdue_mgr');
});

test('past cutoff, overdue already sent -> null', () => {
  const now = confirmByMs(start, 24) + 1;
  expect(nextReminderStage({ ...base, startMs: start, nowMs: now, sentStages: ['overdue_mgr'] })).toBeNull();
});

test('shift already started -> null', () => {
  expect(nextReminderStage({ ...base, startMs: start, nowMs: start + 1 })).toBeNull();
});

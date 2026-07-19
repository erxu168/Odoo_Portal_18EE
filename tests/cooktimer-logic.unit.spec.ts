import { test, expect } from '@playwright/test';
import { berlinStamp, stampToEpoch } from '../src/lib/cooktimer-time';
import {
  deriveDisplayState, stepRemainingSeconds, confirmActionFor, queueAgeTier, formatMMSS,
} from '../src/lib/cooktimer-logic';

type Step = { id: number; seq: number; label: string; durationSeconds: number; stepType: 'cook' | 'rest' | 'action' };
const cook = (secs: number): Step => ({ id: 1, seq: 0, label: 'Fry', durationSeconds: secs, stepType: 'cook' });
const action = (): Step => ({ id: 2, seq: 1, label: 'Flip', durationSeconds: 0, stepType: 'action' });

// --- time: offset-bearing Berlin stamps, DST-safe, never UTC -----------------

test('berlinStamp emits an offset-bearing Berlin stamp and round-trips to the exact epoch', () => {
  const summer = Date.UTC(2026, 6, 19, 13, 30, 0); // 15:30 Berlin (CEST +02:00)
  const s = berlinStamp(summer);
  expect(s).toBe('2026-07-19T15:30:00+02:00');
  expect(stampToEpoch(s)).toBe(summer);

  const winter = Date.UTC(2026, 0, 19, 13, 30, 0); // 14:30 Berlin (CET +01:00)
  const w = berlinStamp(winter);
  expect(w).toBe('2026-01-19T14:30:00+01:00');
  expect(stampToEpoch(w)).toBe(winter);
});

test('berlinStamp is never a UTC toISOString()', () => {
  const t = Date.UTC(2026, 6, 19, 13, 30, 0);
  expect(berlinStamp(t)).not.toBe(new Date(t).toISOString());
  expect(berlinStamp(t).endsWith('Z')).toBe(false);
});

test('stampToEpoch tolerates garbage', () => {
  expect(stampToEpoch('')).toBe(0);
  expect(stampToEpoch(null)).toBe(0);
  expect(stampToEpoch('not-a-date')).toBe(0);
});

// --- remaining ---------------------------------------------------------------

test('stepRemainingSeconds counts down from step start', () => {
  const start = 1_000_000;
  expect(stepRemainingSeconds(210, start, start)).toBe(210);
  expect(stepRemainingSeconds(210, start, start + 60_000)).toBe(150);
  expect(stepRemainingSeconds(210, start, start + 300_000)).toBe(-90); // overdue
});

// --- display state (spec decisions 5, 6, 10) ---------------------------------

test('deriveDisplayState: running -> warnzone (final 15%) -> alarm on a non-final cook step', () => {
  const start = 0;
  const s = cook(200);
  expect(deriveDisplayState(s, start, false, 100_000)).toBe('running');  // 100s left
  expect(deriveDisplayState(s, start, false, 175_000)).toBe('warnzone'); // 25s left (<=30)
  expect(deriveDisplayState(s, start, false, 200_000)).toBe('alarm');    // 0s left, not last
});

test('deriveDisplayState: final cook step at 0 is done, not alarm', () => {
  expect(deriveDisplayState(cook(200), 0, true, 200_000)).toBe('done');
  expect(deriveDisplayState(cook(200), 0, false, 200_000)).toBe('alarm');
});

test('deriveDisplayState: action / zero-duration steps are an immediate alarm (even as the last step)', () => {
  expect(deriveDisplayState(action(), 0, false, 0)).toBe('alarm');
  expect(deriveDisplayState(action(), 0, true, 0)).toBe('alarm');
  expect(deriveDisplayState(cook(0), 0, false, 0)).toBe('alarm');
});

// --- confirm routing ---------------------------------------------------------

test('confirmActionFor: done->finish, last-alarm->finish, mid-alarm->advance, running->null', () => {
  expect(confirmActionFor('done', true)).toBe('finish');
  expect(confirmActionFor('alarm', true)).toBe('finish');
  expect(confirmActionFor('alarm', false)).toBe('advance');
  expect(confirmActionFor('running', false)).toBe(null);
  expect(confirmActionFor('warnzone', false)).toBe(null);
});

// --- queue aging + formatting ------------------------------------------------

test('queueAgeTier: >60s warn, >120s urgent', () => {
  expect(queueAgeTier(30)).toBe('');
  expect(queueAgeTier(61)).toBe('warn');
  expect(queueAgeTier(121)).toBe('urgent');
});

test('formatMMSS rounds up and never goes negative', () => {
  expect(formatMMSS(0)).toBe('0:00');
  expect(formatMMSS(5)).toBe('0:05');
  expect(formatMMSS(65)).toBe('1:05');
  expect(formatMMSS(0.1)).toBe('0:01');
  expect(formatMMSS(-10)).toBe('0:00');
});

import { test, expect } from '@playwright/test';
import {
  nextStaffCheckpoint,
  managerOverdueDue,
  confirmByMs,
  inQuietWindow,
  type ReminderCheckpoints,
  type ReminderStage,
} from '../src/lib/shift-confirm';

const H = 3600e3;
const start = 3 * 24 * H; // shift 3 days out (epoch-ms, test clock starts at 0)

// Checkpoints for a shift at `start`: evening 30h before, morning 9h before, final 3h before.
const cp: ReminderCheckpoints = {
  eveningMs: start - 30 * H,
  morningMs: start - 9 * H,
  finalMs: start - 3 * H,
};
const base = {
  startMs: start,
  checkpoints: cp,
  sentStages: [] as ReminderStage[],
  confirmed: false,
  isQuietNow: false,
};

// -- staff checkpoints ---------------------------------------------------------

test('confirmed -> no staff nudge', () => {
  expect(nextStaffCheckpoint({ ...base, nowMs: start - 20 * H, confirmed: true })).toBeNull();
});

test('before the first checkpoint -> nothing', () => {
  expect(nextStaffCheckpoint({ ...base, nowMs: start - 40 * H })).toBeNull();
});

test('after evening only -> evening', () => {
  expect(nextStaffCheckpoint({ ...base, nowMs: start - 25 * H })).toBe('evening');
});

test('evening already sent, before morning -> nothing', () => {
  expect(nextStaffCheckpoint({ ...base, nowMs: start - 25 * H, sentStages: ['evening'] })).toBeNull();
});

test('after morning -> morning (does not re-fire evening)', () => {
  expect(nextStaffCheckpoint({ ...base, nowMs: start - 8 * H, sentStages: ['evening'] })).toBe('morning');
});

test('after final -> final', () => {
  expect(nextStaffCheckpoint({ ...base, nowMs: start - 2 * H, sentStages: ['evening', 'morning'] })).toBe('final');
});

test('imminent shift, nothing sent -> only the latest due (final), never backfills', () => {
  // A shift published late: now is past all three checkpoints, none sent yet.
  expect(nextStaffCheckpoint({ ...base, nowMs: start - 1 * H })).toBe('final');
});

test('quiet hours suppress staff nudges', () => {
  expect(nextStaffCheckpoint({ ...base, nowMs: start - 25 * H, isQuietNow: true })).toBeNull();
});

test('final earlier than morning (late shift) -> morning still fires after final', () => {
  // e.g. an 11:00 shift with a 3h final lead: final at 08:00, morning at 09:00.
  const oddCp: ReminderCheckpoints = {
    eveningMs: start - 30 * H,
    morningMs: start - 2 * H, // "morning of" lands 2h before start
    finalMs: start - 3 * H, // "final" lands 3h before start (i.e. BEFORE morning)
  };
  // At 2.5h before start: final (3h) already passed, morning (2h) not yet.
  expect(nextStaffCheckpoint({ ...base, checkpoints: oddCp, nowMs: start - 2.5 * H, sentStages: ['evening', 'final'] })).toBeNull();
  // At 1.5h before start: morning (2h) now due and unsent -> morning fires (not skipped by final).
  expect(nextStaffCheckpoint({ ...base, checkpoints: oddCp, nowMs: start - 1.5 * H, sentStages: ['evening', 'final'] })).toBe('morning');
});

test('shift started -> nothing', () => {
  expect(nextStaffCheckpoint({ ...base, nowMs: start + 1 })).toBeNull();
});

// -- manager escalation (decoupled from staff nudges) --------------------------

test('before cutoff -> manager not overdue', () => {
  const now = confirmByMs(start, 24) - 1;
  expect(managerOverdueDue({ startMs: start, nowMs: now, confirmByHours: 24, sentStages: [], confirmed: false })).toBe(false);
});

test('at/after cutoff, unconfirmed, not yet alerted -> overdue', () => {
  const now = confirmByMs(start, 24) + 1;
  expect(managerOverdueDue({ startMs: start, nowMs: now, confirmByHours: 24, sentStages: [], confirmed: false })).toBe(true);
});

test('manager already alerted -> not overdue again', () => {
  const now = confirmByMs(start, 24) + 1;
  expect(managerOverdueDue({ startMs: start, nowMs: now, confirmByHours: 24, sentStages: ['overdue_mgr'], confirmed: false })).toBe(false);
});

test('confirmed -> manager not overdue', () => {
  const now = confirmByMs(start, 24) + 1;
  expect(managerOverdueDue({ startMs: start, nowMs: now, confirmByHours: 24, sentStages: [], confirmed: true })).toBe(false);
});

// -- quiet window --------------------------------------------------------------

test('quiet window wrapping midnight', () => {
  expect(inQuietWindow('23:30', '22:00', '08:00')).toBe(true);
  expect(inQuietWindow('03:00', '22:00', '08:00')).toBe(true);
  expect(inQuietWindow('08:00', '22:00', '08:00')).toBe(false); // end exclusive
  expect(inQuietWindow('18:00', '22:00', '08:00')).toBe(false);
  expect(inQuietWindow('12:00', '22:00', '08:00')).toBe(false);
});

test('quiet window same start/end -> never quiet', () => {
  expect(inQuietWindow('03:00', '00:00', '00:00')).toBe(false);
});

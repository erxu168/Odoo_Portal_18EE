import { test, expect } from '@playwright/test';
import { buildPresence } from '../src/lib/shifts-presence';
import { tallyPunctuality } from '../src/lib/shifts-punctuality';
import type { PunctSlot } from '../src/lib/shifts-punctuality';
import type { OpenAttendance } from '../src/lib/shifts-attendance';
import type { AttendanceRecord } from '../src/lib/shifts-attendance';
import type { ShiftSlot } from '../src/types/shifts';

// -- fixtures ---------------------------------------------------------------

const slot = (o: Partial<ShiftSlot> & { id: number; start: string; end: string }): ShiftSlot => ({
  state: 'published',
  roleId: null,
  roleName: '',
  resourceId: o.employeeId ? o.employeeId * 100 : null,
  employeeId: null,
  employeeName: '',
  departmentId: null,
  departmentName: '',
  note: '',
  overCap: false,
  hours: 0,
  companyId: 6,
  ...o,
});

const open = (list: Array<{ id: number; name?: string; checkIn: string }>): Map<number, OpenAttendance> => {
  const m = new Map<number, OpenAttendance>();
  for (const e of list) {
    m.set(e.id, { attendanceId: e.id * 10, employeeId: e.id, name: e.name ?? `E${e.id}`, checkIn: e.checkIn, workedHours: 0 });
  }
  return m;
};

// Berlin is UTC+2 in July (CEST): "2026-07-15 15:00:00" UTC == 17:00 Berlin.
const NOW = '2026-07-15 15:00:00';

// =============================== PRESENCE ===================================

test('presence: clocked-in with NO rota still shows as present (unscheduled)', () => {
  const r = buildPresence([], open([{ id: 1, name: 'Amina', checkIn: '2026-07-15 14:00:00' }]), NOW, 10);
  expect(r.rows).toHaveLength(0);
  expect(r.unscheduledPresent).toHaveLength(1);
  expect(r.unscheduledPresent[0]).toMatchObject({ employeeId: 1, employeeName: 'Amina', sinceBeforeToday: false });
});

test('presence: a scheduled clocked-in person is a present ROW, not unscheduled', () => {
  const slots = [slot({ id: 100, employeeId: 1, employeeName: 'Amina', start: '2026-07-15 14:00:00', end: '2026-07-15 20:00:00' })];
  const r = buildPresence(slots, open([{ id: 1, checkIn: '2026-07-15 14:05:00' }]), NOW, 10);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].state).toBe('present');
  expect(r.unscheduledPresent).toHaveLength(0);
});

test('presence: draft and unassigned slots are ignored; clocked-in draft person is unscheduled', () => {
  const slots = [
    slot({ id: 100, employeeId: 1, start: '2026-07-15 14:00:00', end: '2026-07-15 20:00:00', state: 'draft' }),
    slot({ id: 101, employeeId: null, start: '2026-07-15 14:00:00', end: '2026-07-15 20:00:00' }), // open shift
  ];
  const r = buildPresence(slots, open([{ id: 1, checkIn: '2026-07-15 14:00:00' }]), NOW, 10);
  expect(r.rows).toHaveLength(0);
  expect(r.unscheduledPresent.map(u => u.employeeId)).toEqual([1]);
});

test('presence: an open clock-in from a previous day is flagged sinceBeforeToday', () => {
  const r = buildPresence([], open([{ id: 2, checkIn: '2026-07-14 14:00:00' }]), NOW, 10);
  expect(r.unscheduledPresent[0].sinceBeforeToday).toBe(true);
});

test('presence: scheduled, no clock-in, past grace → late with minutes', () => {
  const slots = [slot({ id: 100, employeeId: 3, employeeName: 'Ben', start: '2026-07-15 13:00:00', end: '2026-07-15 20:00:00' })];
  const r = buildPresence(slots, open([]), NOW, 10); // now 17:00 Berlin, start 15:00 Berlin
  expect(r.rows[0].state).toBe('late');
  expect(r.rows[0].minsLate).toBe(120);
  expect(r.lateCount).toBe(1);
});

// ============================= PUNCTUALITY ==================================

const rec = (o: Partial<AttendanceRecord> & { id: number; employeeId: number; checkIn: string }): AttendanceRecord => ({
  checkOut: null,
  workedHours: 0,
  planningSlotId: null,
  ...o,
});
const pslot = (id: number, employeeId: number | null, start: string, end: string): PunctSlot => ({ id, employeeId, start, end });
const nameOf = (id: number) => `E${id}`;

test('punctuality: explicit kiosk link (same employee) counts as linked + late minutes', () => {
  const records = [rec({ id: 1, employeeId: 1, checkIn: '2026-07-15 14:10:00', planningSlotId: 100 })];
  const slotById = new Map([[100, pslot(100, 1, '2026-07-15 14:00:00', '2026-07-15 20:00:00')]]);
  const r = tallyPunctuality('2026-W29', records, slotById, [], nameOf);
  expect(r.linkedMatched).toBe(1);
  expect(r.employees[0]).toMatchObject({ employeeId: 1, lateCount: 1, lateMins: 10, matched: 1 });
});

test('punctuality: no link but a unique published same-day slot → fallback match', () => {
  const records = [rec({ id: 1, employeeId: 1, checkIn: '2026-07-15 14:00:00' })];
  const fb = [pslot(100, 1, '2026-07-15 14:00:00', '2026-07-15 20:00:00')];
  const r = tallyPunctuality('2026-W29', records, new Map(), fb, nameOf);
  expect(r.fallbackMatched).toBe(1);
  expect(r.employees[0].lateCount).toBe(0);
  expect(r.employees[0].matched).toBe(1);
});

test('punctuality: several same-day slots → ambiguous, refuse to guess', () => {
  const records = [rec({ id: 1, employeeId: 1, checkIn: '2026-07-15 14:00:00' })];
  const fb = [
    pslot(100, 1, '2026-07-15 08:00:00', '2026-07-15 12:00:00'),
    pslot(101, 1, '2026-07-15 14:00:00', '2026-07-15 20:00:00'),
  ];
  const r = tallyPunctuality('2026-W29', records, new Map(), fb, nameOf);
  expect(r.ambiguous).toBe(1);
  expect(r.employees).toHaveLength(0);
});

test('punctuality: no candidate slot → unmatched', () => {
  const r = tallyPunctuality('2026-W29', [rec({ id: 1, employeeId: 1, checkIn: '2026-07-15 14:00:00' })], new Map(), [], nameOf);
  expect(r.unmatched).toBe(1);
  expect(r.employees).toHaveLength(0);
});

test('punctuality: a link pointing to another employee is rejected (falls through to unmatched)', () => {
  const records = [rec({ id: 1, employeeId: 1, checkIn: '2026-07-15 14:00:00', planningSlotId: 200 })];
  const slotById = new Map([[200, pslot(200, 2, '2026-07-15 14:00:00', '2026-07-15 20:00:00')]]);
  const r = tallyPunctuality('2026-W29', records, slotById, [], nameOf);
  expect(r.linkedMatched).toBe(0);
  expect(r.unmatched).toBe(1);
});

test('punctuality: a shift split across two punches (a break) is judged ONCE, not double-counted', () => {
  // Slot 09:00–17:00 Berlin (07:00–15:00 UTC in July). Punches 09:00–12:00 and 12:30–17:00.
  const records = [
    rec({ id: 1, employeeId: 1, checkIn: '2026-07-15 07:00:00', checkOut: '2026-07-15 10:00:00' }),
    rec({ id: 2, employeeId: 1, checkIn: '2026-07-15 10:30:00', checkOut: '2026-07-15 15:00:00' }),
  ];
  const fb = [pslot(100, 1, '2026-07-15 07:00:00', '2026-07-15 15:00:00')];
  const r = tallyPunctuality('2026-W29', records, new Map(), fb, nameOf);
  expect(r.fallbackMatched).toBe(1); // one shift, not two
  expect(r.employees).toHaveLength(1);
  expect(r.employees[0]).toMatchObject({ matched: 1, lateCount: 0, earlyCount: 0, overCount: 0 });
});

test('punctuality: left-early and overtime are tallied from check_out vs slot end', () => {
  const early = tallyPunctuality(
    '2026-W29',
    [rec({ id: 1, employeeId: 1, checkIn: '2026-07-15 14:00:00', checkOut: '2026-07-15 19:30:00' })],
    new Map(),
    [pslot(100, 1, '2026-07-15 14:00:00', '2026-07-15 20:00:00')],
    nameOf,
  );
  expect(early.employees[0]).toMatchObject({ earlyCount: 1, earlyMins: 30, overCount: 0 });

  const over = tallyPunctuality(
    '2026-W29',
    [rec({ id: 1, employeeId: 1, checkIn: '2026-07-15 14:00:00', checkOut: '2026-07-15 20:45:00' })],
    new Map(),
    [pslot(100, 1, '2026-07-15 14:00:00', '2026-07-15 20:00:00')],
    nameOf,
  );
  expect(over.employees[0]).toMatchObject({ overCount: 1, overMins: 45, earlyCount: 0 });
});

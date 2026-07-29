import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Closing yesterday's unfinished counts.
 *
 * A count is generated every morning and an unfinished one never closed, so they
 * piled up one per day — six days in, the dashboard offered 281 products to
 * count, which was the same forty products over and over.
 *
 * The rule these pin down: a count nobody touched is closed as 'missed'; a count
 * somebody actually entered numbers into is LEFT ALONE. That second half is the
 * important one. Auto-closing a half-finished count would throw away work a
 * person did on a shelf, which is exactly the class of bug this module has been
 * fixing all week.
 *
 * Runs the real expireStaleSessions against a throwaway database.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-expiry-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { getDb } = require('../src/lib/db');
const { initInventoryTables, expireStaleSessions } = require('../src/lib/inventory-db');

const TODAY = '2026-07-29';
const NOW = '2026-07-29T09:00:00.000Z';
const CO = 6;

test.beforeAll(() => { initInventoryTables(); });
test.afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ } });

test.beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM count_entries WHERE session_id >= 990000').run();
  db.prepare('DELETE FROM counting_sessions WHERE id >= 990000').run();
  db.prepare('DELETE FROM counting_templates WHERE id >= 990000').run();
  // One count per list per day is enforced by the real schema, so tests that
  // need two counts on one date need two lists.
  db.prepare(`INSERT OR IGNORE INTO counting_templates
    (id, name, location_id, company_id, created_by, created_at, updated_at) VALUES (990000,?,?,?,?,?,?)`)
    .run('Daily Count', 1, CO, 1, NOW, NOW);
  db.prepare(`INSERT OR IGNORE INTO counting_templates
    (id, name, location_id, company_id, created_by, created_at, updated_at) VALUES (990001,?,?,?,?,?,?)`)
    .run('Other restaurant list', 1, 2, 1, NOW, NOW);
});

function session(id: number, date: string, status = 'in_progress', company = CO) {
  // The list follows the company — a count belongs to its restaurant's list.
  const templateId = company === CO ? 990000 : 990001;
  getDb().prepare(`INSERT INTO counting_sessions
    (id, template_id, scheduled_date, location_id, company_id, status, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, templateId, date, 1, company, status, NOW);
}
function entry(sessionId: number, productId = 990555, spot = 0) {
  getDb().prepare(`INSERT INTO count_entries
    (session_id, product_id, count_location_id, counted_qty, counted_by, counted_at) VALUES (?,?,?,?,?,?)`)
    .run(sessionId, productId, spot, 5, 1, NOW);
}
const statusOf = (id: number) =>
  (getDb().prepare('SELECT status FROM counting_sessions WHERE id = ?').get(id) as { status: string }).status;

test('an untouched count from an earlier day is closed as missed', () => {
  session(990001, '2026-07-28');
  const r = expireStaleSessions(TODAY);
  expect(r.missed).toEqual([990001]);
  expect(statusOf(990001)).toBe('missed');
});

test('THE GUARD: a count somebody entered numbers into is LEFT ALONE', () => {
  session(990002, '2026-07-28');
  entry(990002);
  const r = expireStaleSessions(TODAY);
  expect(r.missed).toEqual([]);
  expect(statusOf(990002), 'a part-counted day must not be closed automatically').toBe('in_progress');
  expect(r.leftAlone.map((s: any) => s.id)).toEqual([990002]);
  expect(r.leftAlone[0].entries).toBe(1);
});

test('the part-counted one is reported so a manager can act on it', () => {
  session(990003, '2026-07-26'); entry(990003);
  session(990004, '2026-07-27');           // untouched
  const r = expireStaleSessions(TODAY);
  expect(r.missed).toEqual([990004]);
  expect(r.leftAlone).toEqual([{ id: 990003, scheduled_date: '2026-07-26', entries: 1 }]);
});

test('TODAY is never touched, counted or not', () => {
  session(990005, TODAY);                  // untouched, but it is today's
  const r = expireStaleSessions(TODAY);
  expect(r.missed).toEqual([]);
  expect(statusOf(990005)).toBe('in_progress');
});

test('a future-dated count is never touched', () => {
  session(990006, '2026-08-01');
  expireStaleSessions(TODAY);
  expect(statusOf(990006)).toBe('in_progress');
});

test('submitted, approved and rejected counts are never touched', () => {
  // Different dates: one count per list per day.
  ['submitted', 'approved', 'rejected'].forEach((st, i) => {
    session(990010 + i, `2026-07-2${i}`, st);
  });
  const r = expireStaleSessions(TODAY);
  expect(r.missed).toEqual([]);
  expect(statusOf(990010)).toBe('submitted');
  expect(statusOf(990011)).toBe('approved');
  expect(statusOf(990012)).toBe('rejected');
});

test('a pending count is closed just like an in_progress one', () => {
  session(990020, '2026-07-27', 'pending');
  expireStaleSessions(TODAY);
  expect(statusOf(990020)).toBe('missed');
});

test('running it twice changes nothing the second time', () => {
  session(990030, '2026-07-27');
  expect(expireStaleSessions(TODAY).missed).toEqual([990030]);
  expect(expireStaleSessions(TODAY).missed, 'already missed, nothing left to close').toEqual([]);
  expect(statusOf(990030)).toBe('missed');
});

test('company scope is respected — another restaurant is left alone', () => {
  session(990040, '2026-07-27', 'in_progress', CO);
  session(990041, '2026-07-27', 'in_progress', 2);      // a different restaurant
  const r = expireStaleSessions(TODAY, [CO]);
  expect(r.missed).toEqual([990040]);
  expect(statusOf(990041), 'another company must be untouched').toBe('in_progress');
});

test('six days of untouched counts all close in one run — the pile-up', () => {
  ['2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28']
    .forEach((d, i) => session(990050 + i, d));
  const r = expireStaleSessions(TODAY);
  expect(r.missed.length).toBe(6);
  expect(r.leftAlone).toEqual([]);
});

test('THE OTHER GUARD: a spot SKIPPED with a reason is work too', () => {
  // Guided counting lets someone mark a whole spot "skipped — fridge was
  // locked". No quantity is entered, but a person stood there and decided
  // something. Judging emptiness by count_entries alone would close that day
  // and throw the decision away — and this module already treats a non-pending
  // location status as real progress everywhere else.
  session(990070, '2026-07-27');
  getDb().prepare(`INSERT INTO session_location_status
    (session_id, count_location_id, status, skip_reason, updated_at) VALUES (?,?,?,?,?)`)
    .run(990070, 3, 'skipped', 'fridge was locked', NOW);
  const r = expireStaleSessions(TODAY);
  expect(r.missed, 'a skipped spot means the day was not missed').toEqual([]);
  expect(statusOf(990070)).toBe('in_progress');
  expect(r.leftAlone.map((x: any) => x.id)).toEqual([990070]);
});

test('a location row still PENDING is not progress', () => {
  // The row exists because the count was set up, not because anyone acted.
  session(990071, '2026-07-27');
  getDb().prepare(`INSERT INTO session_location_status
    (session_id, count_location_id, status, updated_at) VALUES (?,?,?,?)`)
    .run(990071, 3, 'pending', NOW);
  expect(expireStaleSessions(TODAY).missed).toEqual([990071]);
});

test('only sessions actually updated are reported as missed', () => {
  // If work lands between the scan and the write, the guarded UPDATE matches
  // nothing — and the run must not claim it closed something it did not.
  session(990080, '2026-07-27', 'submitted');   // not closeable
  const r = expireStaleSessions(TODAY);
  expect(r.missed).toEqual([]);
});

test('a mixed pile-up closes only the empty days', () => {
  session(990060, '2026-07-25');                 // empty
  session(990061, '2026-07-26'); entry(990061);  // has work
  session(990062, '2026-07-27');                 // empty
  const r = expireStaleSessions(TODAY);
  expect(r.missed.sort()).toEqual([990060, 990062]);
  expect(statusOf(990061)).toBe('in_progress');
});

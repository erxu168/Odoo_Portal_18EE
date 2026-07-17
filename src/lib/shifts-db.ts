/**
 * Shifts module — portal SQLite layer.
 *
 * Cover requests, sick reports, per-company settings and in-app notifications.
 * Odoo planning.slot stays the source of truth for the shifts themselves; this
 * DB only holds the portal-side workflow state.
 *
 * Concurrency rules (non-negotiable):
 * - Every status transition is a compare-and-swap: UPDATE … WHERE status IN (…).
 *   0 rows changed → the state moved underneath → caller reloads and surfaces it.
 * - Active-request uniqueness per slot is enforced by a partial unique index
 *   (double-tap safe) — createCoverRequest catches the constraint error.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { getDb } from '@/lib/db';
import type { ReminderStage } from '@/lib/shift-confirm';
import type {
  CoverRequest,
  PublishRunState,
  ShiftNotification,
  ShiftPattern,
  ShiftPatternLine,
  ShiftPublishRun,
  ShiftSettings,
  ShiftTemplate,
  SickReport,
  SlotSnapshot,
} from '@/types/shifts';

export type {
  CoverRequest,
  ShiftNotification,
  ShiftSettings,
  SickReport,
  SlotSnapshot,
} from '@/types/shifts';

function nowISO(): string {
  return new Date().toISOString();
}

let _initialized = false;

function ensureTables(): void {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_cover_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      from_employee_id INTEGER NOT NULL,
      to_employee_id INTEGER,
      ask_all INTEGER NOT NULL DEFAULT 0,
      accepted_by_employee_id INTEGER,
      message TEXT,
      status TEXT NOT NULL,
      slot_snapshot TEXT NOT NULL,
      answer_deadline TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_by_employee_id INTEGER,
      decided_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cover_active
      ON shift_cover_requests(slot_id) WHERE status IN ('pending_teammate','pending_manager');
    CREATE INDEX IF NOT EXISTS idx_cover_company_status
      ON shift_cover_requests(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_cover_from
      ON shift_cover_requests(from_employee_id);
    CREATE INDEX IF NOT EXISTS idx_cover_to
      ON shift_cover_requests(to_employee_id);

    CREATE TABLE IF NOT EXISTS shift_sick_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      note TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_action TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sick_company_status
      ON shift_sick_reports(company_id, status);

    CREATE TABLE IF NOT EXISTS shift_settings (
      company_id INTEGER PRIMARY KEY,
      require_approval INTEGER NOT NULL DEFAULT 1,
      answer_deadline_hours REAL NOT NULL DEFAULT 12,
      settle_buffer_hours REAL NOT NULL DEFAULT 2,
      allow_ask_all INTEGER NOT NULL DEFAULT 1,
      allow_sick_report INTEGER NOT NULL DEFAULT 1,
      require_confirmation INTEGER NOT NULL DEFAULT 0,
      confirm_by_hours REAL NOT NULL DEFAULT 24,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS shift_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shift_notif_employee
      ON shift_notifications(employee_id, created_at);

    CREATE TABLE IF NOT EXISTS shift_kiosk_pins (
      company_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      pin TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (company_id, employee_id)
    );

    CREATE TABLE IF NOT EXISTS shift_confirmations (
      slot_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      confirmed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_confirm_company ON shift_confirmations(company_id);

    CREATE TABLE IF NOT EXISTS shift_confirm_reminders (
      slot_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (slot_id, stage)
    );

    CREATE TABLE IF NOT EXISTS shift_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_hhmm TEXT NOT NULL,
      end_hhmm TEXT NOT NULL,
      role_id INTEGER,
      headcount INTEGER NOT NULL DEFAULT 1,
      min_skill TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_template_company ON shift_templates(company_id);

    CREATE TABLE IF NOT EXISTS shift_slot_department (
      slot_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      department_id INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slot_dept_company ON shift_slot_department(company_id);

    CREATE TABLE IF NOT EXISTS shift_slot_min_skill (
      slot_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      min_skill TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slot_skill_company ON shift_slot_min_skill(company_id);

    CREATE TABLE IF NOT EXISTS shift_pattern (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pattern_company ON shift_pattern(company_id);

    CREATE TABLE IF NOT EXISTS shift_pattern_line (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      start_hhmm TEXT NOT NULL,
      end_hhmm TEXT NOT NULL,
      role_id INTEGER,
      department_id INTEGER,
      headcount INTEGER NOT NULL DEFAULT 1,
      min_skill TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pattern_line_pattern ON shift_pattern_line(pattern_id);

    CREATE TABLE IF NOT EXISTS shift_publish_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      pattern_id INTEGER,
      week_key TEXT NOT NULL,
      select_deadline TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_publish_run_company ON shift_publish_run(company_id);

    CREATE TABLE IF NOT EXISTS shift_publish_slot (
      run_id INTEGER NOT NULL,
      slot_id INTEGER NOT NULL,
      PRIMARY KEY (run_id, slot_id)
    );

    CREATE TABLE IF NOT EXISTS shift_weekend_config (
      company_id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS shift_weekend_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      period_key TEXT NOT NULL,
      quota_required INTEGER NOT NULL DEFAULT 0,
      weekend_worked INTEGER NOT NULL DEFAULT 0,
      gate_unlocked_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id, employee_id, period_key)
    );
    CREATE INDEX IF NOT EXISTS idx_wknd_hist_emp ON shift_weekend_history(company_id, employee_id, period_key);

    -- Kiosk: one-time 6-digit code emailed for first-time PIN setup (stored hashed).
    CREATE TABLE IF NOT EXISTS kiosk_setup_codes (
      company_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (company_id, employee_id)
    );

    -- Kiosk: one-time token behind the "forgot PIN" reset link.
    CREATE TABLE IF NOT EXISTS kiosk_pin_reset_tokens (
      token TEXT PRIMARY KEY,
      company_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kiosk_reset_expires ON kiosk_pin_reset_tokens(expires_at);

    -- Shift confirmation: one-time token behind the "confirm you'll be there" link
    -- in reminder emails (lets a staffer confirm without logging in). One live
    -- token per (slot, employee); reused across a shift's reminder emails.
    CREATE TABLE IF NOT EXISTS shift_confirm_tokens (
      token TEXT PRIMARY KEY,
      slot_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_confirm_token_slot_emp ON shift_confirm_tokens(slot_id, employee_id);
    CREATE INDEX IF NOT EXISTS idx_shift_confirm_token_expires ON shift_confirm_tokens(expires_at);

    -- Kiosk: who is currently on a break. A break = clocked out with the intent
    -- to return, so there is no open Odoo attendance while on break. break_started_at
    -- is the Odoo UTC check_out of the segment they broke from; attendance_id is that
    -- segment (used to write the hr.break + its total_break_time on return).
    CREATE TABLE IF NOT EXISTS kiosk_on_break (
      company_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      break_started_at TEXT NOT NULL,
      attendance_id INTEGER NOT NULL,
      PRIMARY KEY (company_id, employee_id)
    );
  `);

  // Additive migrations for DBs created before a column existed (fresh DBs get
  // them from the CREATE above; ADD COLUMN throws "duplicate column" if present).
  for (const [col, def] of [
    ['require_confirmation', 'INTEGER NOT NULL DEFAULT 0'],
    ['confirm_by_hours', 'REAL NOT NULL DEFAULT 24'],
    ['reminder_email_enabled', "INTEGER NOT NULL DEFAULT 0"],
    ['reminder_evening_time', "TEXT NOT NULL DEFAULT '18:00'"],
    ['reminder_morning_time', "TEXT NOT NULL DEFAULT '09:00'"],
    ['reminder_final_lead_hours', 'REAL NOT NULL DEFAULT 3'],
    ['reminder_quiet_start', "TEXT NOT NULL DEFAULT '22:00'"],
    ['reminder_quiet_end', "TEXT NOT NULL DEFAULT '08:00'"],
  ] as const) {
    try { db.exec(`ALTER TABLE shift_settings ADD COLUMN ${col} ${def}`); }
    catch (e) { if (!String((e as Error)?.message).includes('duplicate column')) throw e; }
  }
  try { db.exec('ALTER TABLE shift_templates ADD COLUMN min_skill TEXT'); }
  catch (e) { if (!String((e as Error)?.message).includes('duplicate column')) throw e; }

  _initialized = true;
}

// -- Slot minimum skill (open shifts: only ≥ level staff may claim) --------------

/**
 * Set (or clear, when minSkill is null) the minimum skill level required to
 * claim an open slot. '1' (Level 1 = anyone) is treated as no requirement and
 * clears the row; store only '2' or '3'.
 */
export function setSlotMinSkill(companyId: number, slotId: number, minSkill: string | null): void {
  ensureTables();
  const db = getDb();
  if (minSkill === null || minSkill === '1') {
    db.prepare('DELETE FROM shift_slot_min_skill WHERE slot_id=?').run(slotId);
    return;
  }
  db.prepare(
    `INSERT INTO shift_slot_min_skill (slot_id, company_id, min_skill)
     VALUES (?,?,?)
     ON CONFLICT(slot_id) DO UPDATE SET company_id=excluded.company_id, min_skill=excluded.min_skill`,
  ).run(slotId, companyId, minSkill);
}

/** Apply the same minimum skill to many slots at once (batch create). */
export function setSlotMinSkills(companyId: number, slotIds: number[], minSkill: string | null): void {
  if (slotIds.length === 0) return;
  ensureTables();
  const db = getDb();
  const tx = db.transaction((ids: number[]) => {
    for (const id of ids) setSlotMinSkill(companyId, id, minSkill);
  });
  tx(slotIds);
}

/** slot_id → required min skill ('2'|'3') for the given slots (only those set). */
export function slotMinSkills(companyId: number, slotIds: number[]): Map<number, string> {
  ensureTables();
  const map = new Map<number, string>();
  if (slotIds.length === 0) return map;
  const placeholders = slotIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT slot_id, min_skill FROM shift_slot_min_skill
       WHERE company_id=? AND slot_id IN (${placeholders})`,
    )
    .all(companyId, ...slotIds) as { slot_id: number; min_skill: string }[];
  for (const r of rows) map.set(r.slot_id, r.min_skill);
  return map;
}

/** One slot's required min skill, or null. */
export function slotMinSkill(companyId: number, slotId: number): string | null {
  return slotMinSkills(companyId, [slotId]).get(slotId) ?? null;
}

/** Remove a slot's min-skill requirement (call on slot delete). */
export function deleteSlotMinSkill(slotId: number): void {
  ensureTables();
  getDb().prepare('DELETE FROM shift_slot_min_skill WHERE slot_id=?').run(slotId);
}

// -- Slot department (manager's chosen dept; slot.department_id is readonly) -----

/**
 * Set (or clear, when departmentId is null) the manager-chosen department for a
 * slot. planning.slot.department_id is a readonly Odoo relation derived from the
 * assignee, so the portal keeps the authoritative choice here — works for open
 * (unassigned) shifts too.
 */
export function setSlotDepartment(companyId: number, slotId: number, departmentId: number | null): void {
  ensureTables();
  const db = getDb();
  if (departmentId === null) {
    db.prepare('DELETE FROM shift_slot_department WHERE slot_id=?').run(slotId);
    return;
  }
  db.prepare(
    `INSERT INTO shift_slot_department (slot_id, company_id, department_id)
     VALUES (?,?,?)
     ON CONFLICT(slot_id) DO UPDATE SET company_id=excluded.company_id, department_id=excluded.department_id`,
  ).run(slotId, companyId, departmentId);
}

/** Set the same department on many slots at once (used when creating a batch). */
export function setSlotDepartments(companyId: number, slotIds: number[], departmentId: number | null): void {
  if (slotIds.length === 0) return;
  ensureTables();
  const db = getDb();
  const tx = db.transaction((ids: number[]) => {
    for (const id of ids) setSlotDepartment(companyId, id, departmentId);
  });
  tx(slotIds);
}

/** slot_id → department_id for the given slots (only those with an override set). */
export function slotDepartments(companyId: number, slotIds: number[]): Map<number, number> {
  ensureTables();
  const map = new Map<number, number>();
  if (slotIds.length === 0) return map;
  const placeholders = slotIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT slot_id, department_id FROM shift_slot_department
       WHERE company_id=? AND slot_id IN (${placeholders})`,
    )
    .all(companyId, ...slotIds) as { slot_id: number; department_id: number }[];
  for (const r of rows) map.set(r.slot_id, r.department_id);
  return map;
}

/** Remove a slot's department override (call on slot delete). */
export function deleteSlotDepartment(slotId: number): void {
  ensureTables();
  getDb().prepare('DELETE FROM shift_slot_department WHERE slot_id=?').run(slotId);
}

/** How many slot department-overrides point at this department (delete guard). */
export function countSlotsUsingDepartment(companyId: number, departmentId: number): number {
  ensureTables();
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM shift_slot_department WHERE company_id=? AND department_id=?')
    .get(companyId, departmentId) as { c: number };
  return row.c;
}

// -- Shift confirmations (staff "I'll be there") --------------------------------

/** Record a staff confirmation for a slot (idempotent per slot). */
export function confirmSlot(slotId: number, companyId: number, employeeId: number): void {
  ensureTables();
  getDb()
    .prepare(
      `INSERT INTO shift_confirmations (slot_id, company_id, employee_id, confirmed_at)
       VALUES (?,?,?,?)
       ON CONFLICT(slot_id) DO UPDATE SET employee_id=excluded.employee_id, confirmed_at=excluded.confirmed_at`,
    )
    .run(slotId, companyId, employeeId, nowISO());
}

/** slot_ids in the company that have been confirmed by staff. */
export function confirmedSlotIds(companyId: number): Set<number> {
  ensureTables();
  const rows = getDb()
    .prepare('SELECT slot_id FROM shift_confirmations WHERE company_id=?')
    .all(companyId) as { slot_id: number }[];
  return new Set(rows.map(r => r.slot_id));
}

/** Remove a slot's confirmation (e.g. when it is reassigned to someone else). */
export function clearConfirmation(slotId: number): void {
  ensureTables();
  getDb().prepare('DELETE FROM shift_confirmations WHERE slot_id=?').run(slotId);
}

/** Reminder stages already sent for a slot (dedup for the confirmation cron). */
export function reminderStagesSent(slotId: number): ReminderStage[] {
  ensureTables();
  return (getDb().prepare('SELECT stage FROM shift_confirm_reminders WHERE slot_id=?').all(slotId) as { stage: string }[])
    .map(r => r.stage as ReminderStage);
}

/** Record that a reminder stage has been sent for a slot (at-most-once). */
export function markReminderSent(slotId: number, stage: ReminderStage): void {
  ensureTables();
  getDb().prepare('INSERT OR IGNORE INTO shift_confirm_reminders (slot_id, stage, sent_at) VALUES (?,?,?)').run(slotId, stage, nowISO());
}

/**
 * Drop a slot's reminder history AND its confirm tokens (on reassign / time edit /
 * unpublish / cover — anything that resets confirmation), so the new assignee (or
 * moved shift) starts fresh and any old email link stops working. Every reset path
 * already calls this alongside clearConfirmation, so folding the token cleanup in
 * here keeps all of them covered without touching each call site.
 */
export function clearConfirmReminders(slotId: number): void {
  ensureTables();
  getDb().prepare('DELETE FROM shift_confirm_reminders WHERE slot_id=?').run(slotId);
  clearShiftConfirmTokens(slotId);
}

// -- Kiosk PINs -----------------------------------------------------------------

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function checkPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(pin, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// PIN uniqueness enforcement removed: a person is identified NAME-first everywhere
// (clock-in kiosk + kitchen tablet), then their own PIN is verified — so two staff
// may safely share a PIN. See setKioskPin below and verifyStationPersonPin.

/**
 * Set (empty/null clears) a staff member's kiosk PIN — the single canonical staff PIN
 * (clock-in + kitchen-tablet login + shift attribution). PINs need NOT be unique per
 * restaurant: sign-in is name-first everywhere, so two staff may share a PIN. The upsert
 * is a single atomic statement (keyed on company_id + employee_id).
 */
export function setKioskPin(companyId: number, employeeId: number, pin: string | null): void {
  ensureTables();
  const db = getDb();
  if (!pin) {
    db.prepare('DELETE FROM shift_kiosk_pins WHERE company_id=? AND employee_id=?').run(companyId, employeeId);
    return;
  }
  db.prepare(
    `INSERT INTO shift_kiosk_pins (company_id, employee_id, pin, updated_at)
     VALUES (?,?,?,?)
     ON CONFLICT(company_id, employee_id) DO UPDATE SET pin=excluded.pin, updated_at=excluded.updated_at`,
  ).run(companyId, employeeId, hashPin(pin), nowISO());
}

export function verifyKioskPin(companyId: number, employeeId: number, pin: string): boolean {
  ensureTables();
  const row = getDb()
    .prepare('SELECT pin FROM shift_kiosk_pins WHERE company_id=? AND employee_id=?')
    .get(companyId, employeeId) as { pin: string } | undefined;
  return row ? checkPin(pin, row.pin) : false;
}

/** employeeIds of the company that have a kiosk PIN set. */
export function employeesWithPin(companyId: number): Set<number> {
  ensureTables();
  const rows = getDb()
    .prepare('SELECT employee_id FROM shift_kiosk_pins WHERE company_id=?')
    .all(companyId) as { employee_id: number }[];
  return new Set(rows.map(r => r.employee_id));
}

/** True when this employee already has a kiosk PIN for the company. */
export function hasKioskPin(companyId: number, employeeId: number): boolean {
  ensureTables();
  return !!getDb()
    .prepare('SELECT 1 FROM shift_kiosk_pins WHERE company_id=? AND employee_id=?')
    .get(companyId, employeeId);
}

// -- Kiosk on-break state -------------------------------------------------------

/** A marker that a break longer than this is stale (person left without returning). */
export const ON_BREAK_STALE_MS = 12 * 60 * 60_000; // 12 hours

export interface OnBreakRow {
  breakStartedAt: string;
  attendanceId: number;
}

/** Mark an employee as on break (clocked out, intending to return). */
export function setOnBreak(
  companyId: number,
  employeeId: number,
  breakStartedAt: string,
  attendanceId: number,
): void {
  ensureTables();
  getDb()
    .prepare(
      `INSERT INTO kiosk_on_break (company_id, employee_id, break_started_at, attendance_id)
       VALUES (?,?,?,?)
       ON CONFLICT(company_id, employee_id)
       DO UPDATE SET break_started_at=excluded.break_started_at, attendance_id=excluded.attendance_id`,
    )
    .run(companyId, employeeId, breakStartedAt, attendanceId);
}

/** Clear an employee's on-break marker (returned or ended shift). */
export function clearOnBreak(companyId: number, employeeId: number): void {
  ensureTables();
  getDb().prepare('DELETE FROM kiosk_on_break WHERE company_id=? AND employee_id=?').run(companyId, employeeId);
}

/** The raw on-break marker, or null when none. Does not consider staleness. */
export function getOnBreak(companyId: number, employeeId: number): OnBreakRow | null {
  ensureTables();
  const row = getDb()
    .prepare('SELECT break_started_at, attendance_id FROM kiosk_on_break WHERE company_id=? AND employee_id=?')
    .get(companyId, employeeId) as { break_started_at: string; attendance_id: number } | undefined;
  return row ? { breakStartedAt: row.break_started_at, attendanceId: row.attendance_id } : null;
}

/** employeeIds of the company currently on a *fresh* break (stale markers ignored). */
export function onBreakEmployeeIds(companyId: number, staleBeforeIso: string): Set<number> {
  ensureTables();
  const rows = getDb()
    .prepare('SELECT employee_id FROM kiosk_on_break WHERE company_id=? AND break_started_at >= ?')
    .all(companyId, staleBeforeIso) as { employee_id: number }[];
  return new Set(rows.map(r => r.employee_id));
}

// -- Kiosk first-time setup codes (emailed 6-digit, entered at the tablet) -------

const SETUP_CODE_TTL_MS = 15 * 60_000; // 15 minutes
const SETUP_CODE_MAX_ATTEMPTS = 5;

/** Create/replace a one-time setup code for (company, employee); stored hashed. */
export function createKioskSetupCode(companyId: number, employeeId: number, code: string): void {
  ensureTables();
  const expires = new Date(Date.now() + SETUP_CODE_TTL_MS).toISOString();
  getDb()
    .prepare(
      `INSERT INTO kiosk_setup_codes (company_id, employee_id, code, expires_at, attempts)
       VALUES (?,?,?,?,0)
       ON CONFLICT(company_id, employee_id)
       DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, attempts=0`,
    )
    .run(companyId, employeeId, hashPin(code), expires);
}

/**
 * Verify a setup code. On a correct, unexpired, un-exhausted code: deletes it and
 * returns true. On a wrong code: increments attempts and returns false. Expired or
 * too-many-attempts codes are cleared and return false.
 */
export function verifyKioskSetupCode(companyId: number, employeeId: number, code: string): boolean {
  ensureTables();
  const db = getDb();
  const row = db
    .prepare('SELECT code, expires_at, attempts FROM kiosk_setup_codes WHERE company_id=? AND employee_id=?')
    .get(companyId, employeeId) as { code: string; expires_at: string; attempts: number } | undefined;
  if (!row) return false;
  const drop = () =>
    db.prepare('DELETE FROM kiosk_setup_codes WHERE company_id=? AND employee_id=?').run(companyId, employeeId);
  if (row.expires_at < nowISO() || row.attempts >= SETUP_CODE_MAX_ATTEMPTS) {
    drop();
    return false;
  }
  if (!checkPin(code, row.code)) {
    db.prepare('UPDATE kiosk_setup_codes SET attempts=attempts+1 WHERE company_id=? AND employee_id=?').run(
      companyId,
      employeeId,
    );
    return false;
  }
  drop();
  return true;
}

// -- Kiosk PIN reset tokens (behind the "forgot PIN" email link) -----------------

const PIN_RESET_TTL_MS = 60 * 60_000; // 1 hour

/** Create a one-time reset token for (company, employee); returns the token string. */
export function createKioskPinResetToken(companyId: number, employeeId: number): string {
  ensureTables();
  const db = getDb();
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM kiosk_pin_reset_tokens WHERE company_id=? AND employee_id=?').run(companyId, employeeId);
  db.prepare('DELETE FROM kiosk_pin_reset_tokens WHERE expires_at < ?').run(nowISO());
  const expires = new Date(Date.now() + PIN_RESET_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO kiosk_pin_reset_tokens (token, company_id, employee_id, created_at, expires_at) VALUES (?,?,?,?,?)',
  ).run(token, companyId, employeeId, nowISO(), expires);
  return token;
}

/**
 * Redeem a reset token AND set the new PIN in ONE transaction: claim (delete) the token
 * and write the PIN atomically. Because it's one transaction, the same token can't be
 * double-used across concurrent workers. Returns the reason on failure. (PINs need not be
 * unique — the reset link already proves identity and sign-in is name-first.)
 */
export type ResetRedeem = { ok: true } | { ok: false; reason: 'invalid' };
export function redeemKioskPinResetToken(token: string, pin: string): ResetRedeem {
  ensureTables();
  const db = getDb();
  const run = db.transaction((): ResetRedeem => {
    const row = db
      .prepare('SELECT company_id, employee_id FROM kiosk_pin_reset_tokens WHERE token=? AND expires_at > ?')
      .get(token, nowISO()) as { company_id: number; employee_id: number } | undefined;
    // Reject an unknown/expired token BEFORE any scrypt work — /api/kiosk/reset is public,
    // so we must not let invalid requests block the event loop hashing a PIN.
    if (!row) return { ok: false, reason: 'invalid' };
    // Claim the one-time token, then write the new PIN.
    db.prepare('DELETE FROM kiosk_pin_reset_tokens WHERE token=?').run(token);
    db.prepare(
      `INSERT INTO shift_kiosk_pins (company_id, employee_id, pin, updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(company_id, employee_id) DO UPDATE SET pin=excluded.pin, updated_at=excluded.updated_at`,
    ).run(row.company_id, row.employee_id, hashPin(pin), nowISO());
    return { ok: true };
  });
  return run.immediate(); // BEGIN IMMEDIATE — one-shot claim + write
}

// -- Settings -------------------------------------------------------------------

interface SettingsRow {
  company_id: number;
  require_approval: number;
  answer_deadline_hours: number;
  settle_buffer_hours: number;
  allow_ask_all: number;
  allow_sick_report: number;
  require_confirmation: number;
  confirm_by_hours: number;
  reminder_email_enabled: number;
  reminder_evening_time: string;
  reminder_morning_time: string;
  reminder_final_lead_hours: number;
  reminder_quiet_start: string;
  reminder_quiet_end: string;
}

/** Defaults for the email-reminder fields (also used when a settings row predates them). */
const REMINDER_DEFAULTS = {
  reminderEmailEnabled: false,
  reminderEveningTime: '18:00',
  reminderMorningTime: '09:00',
  reminderFinalLeadHours: 3,
  reminderQuietStart: '22:00',
  reminderQuietEnd: '08:00',
} as const;

/** Per-company shift settings. Missing row → defaults 1/12/2/1/1, confirmation off/24h. */
export function getShiftSettings(companyId: number): ShiftSettings {
  ensureTables();
  const row = getDb()
    .prepare('SELECT * FROM shift_settings WHERE company_id = ?')
    .get(companyId) as SettingsRow | undefined;
  if (!row) {
    return {
      companyId,
      requireApproval: true,
      answerDeadlineHours: 12,
      settleBufferHours: 2,
      allowAskAll: true,
      allowSickReport: true,
      requireConfirmation: false,
      confirmByHours: 24,
      ...REMINDER_DEFAULTS,
    };
  }
  return {
    companyId: row.company_id,
    requireApproval: row.require_approval === 1,
    answerDeadlineHours: row.answer_deadline_hours,
    settleBufferHours: row.settle_buffer_hours,
    allowAskAll: row.allow_ask_all === 1,
    allowSickReport: row.allow_sick_report === 1,
    requireConfirmation: row.require_confirmation === 1,
    confirmByHours: row.confirm_by_hours ?? 24,
    reminderEmailEnabled: row.reminder_email_enabled === 1,
    reminderEveningTime: row.reminder_evening_time || REMINDER_DEFAULTS.reminderEveningTime,
    reminderMorningTime: row.reminder_morning_time || REMINDER_DEFAULTS.reminderMorningTime,
    reminderFinalLeadHours: row.reminder_final_lead_hours ?? REMINDER_DEFAULTS.reminderFinalLeadHours,
    reminderQuietStart: row.reminder_quiet_start || REMINDER_DEFAULTS.reminderQuietStart,
    reminderQuietEnd: row.reminder_quiet_end || REMINDER_DEFAULTS.reminderQuietEnd,
  };
}

/** company_ids that currently have shift confirmation switched on (for the cron). */
export function companiesRequiringConfirmation(): number[] {
  ensureTables();
  return (getDb().prepare('SELECT company_id FROM shift_settings WHERE require_confirmation = 1').all() as { company_id: number }[])
    .map(r => r.company_id);
}

export function saveShiftSettings(s: ShiftSettings): void {
  ensureTables();
  getDb().prepare(`
    INSERT INTO shift_settings (company_id, require_approval, answer_deadline_hours, settle_buffer_hours, allow_ask_all, allow_sick_report, require_confirmation, confirm_by_hours, reminder_email_enabled, reminder_evening_time, reminder_morning_time, reminder_final_lead_hours, reminder_quiet_start, reminder_quiet_end, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
      require_approval = excluded.require_approval,
      answer_deadline_hours = excluded.answer_deadline_hours,
      settle_buffer_hours = excluded.settle_buffer_hours,
      allow_ask_all = excluded.allow_ask_all,
      allow_sick_report = excluded.allow_sick_report,
      require_confirmation = excluded.require_confirmation,
      confirm_by_hours = excluded.confirm_by_hours,
      reminder_email_enabled = excluded.reminder_email_enabled,
      reminder_evening_time = excluded.reminder_evening_time,
      reminder_morning_time = excluded.reminder_morning_time,
      reminder_final_lead_hours = excluded.reminder_final_lead_hours,
      reminder_quiet_start = excluded.reminder_quiet_start,
      reminder_quiet_end = excluded.reminder_quiet_end,
      updated_at = excluded.updated_at
  `).run(
    s.companyId,
    s.requireApproval ? 1 : 0,
    s.answerDeadlineHours,
    s.settleBufferHours,
    s.allowAskAll ? 1 : 0,
    s.allowSickReport ? 1 : 0,
    s.requireConfirmation ? 1 : 0,
    s.confirmByHours,
    s.reminderEmailEnabled ? 1 : 0,
    s.reminderEveningTime,
    s.reminderMorningTime,
    s.reminderFinalLeadHours,
    s.reminderQuietStart,
    s.reminderQuietEnd,
    nowISO(),
  );
}

// -- Shift confirm tokens (behind the "confirm you'll be there" email link) ------

/**
 * One-time-ish token that lets a staffer confirm a shift from a reminder email
 * without logging in. Reuses a live token for the same (slot, employee) so every
 * reminder email for a shift carries the same link; expiresAtISO should be just
 * past the shift so the link dies afterwards. The token is NOT consumed on use —
 * confirming is idempotent, so a re-click still lands on a friendly "confirmed".
 */
export function getOrCreateShiftConfirmToken(
  slotId: number,
  companyId: number,
  employeeId: number,
  expiresAtISO: string,
): string {
  ensureTables();
  const db = getDb();
  db.prepare('DELETE FROM shift_confirm_tokens WHERE expires_at < ?').run(nowISO());
  const existing = db
    .prepare('SELECT token FROM shift_confirm_tokens WHERE slot_id=? AND employee_id=? AND expires_at > ?')
    .get(slotId, employeeId, nowISO()) as { token: string } | undefined;
  if (existing) return existing.token;
  const token = randomBytes(32).toString('hex');
  db.prepare(
    'INSERT OR REPLACE INTO shift_confirm_tokens (token, slot_id, company_id, employee_id, created_at, expires_at) VALUES (?,?,?,?,?,?)',
  ).run(token, slotId, companyId, employeeId, nowISO(), expiresAtISO);
  return token;
}

/** Resolve a confirm token → {slotId, companyId, employeeId}, or null if invalid/expired. Not consumed. */
export function resolveShiftConfirmToken(token: string): { slotId: number; companyId: number; employeeId: number } | null {
  ensureTables();
  const row = getDb()
    .prepare('SELECT slot_id, company_id, employee_id FROM shift_confirm_tokens WHERE token=? AND expires_at > ?')
    .get(token, nowISO()) as { slot_id: number; company_id: number; employee_id: number } | undefined;
  if (!row) return null;
  return { slotId: row.slot_id, companyId: row.company_id, employeeId: row.employee_id };
}

/** Drop a slot's confirm tokens (e.g. when it is reassigned). */
export function clearShiftConfirmTokens(slotId: number): void {
  ensureTables();
  getDb().prepare('DELETE FROM shift_confirm_tokens WHERE slot_id=?').run(slotId);
}

// -- Cover requests ---------------------------------------------------------------

interface CoverRequestRow {
  id: number;
  slot_id: number;
  company_id: number;
  from_employee_id: number;
  to_employee_id: number | null;
  ask_all: number;
  accepted_by_employee_id: number | null;
  message: string | null;
  status: string;
  slot_snapshot: string;
  answer_deadline: string;
  created_at: string;
  updated_at: string;
  decided_by_employee_id: number | null;
  decided_at: string | null;
}

function parseSnapshot(raw: string): SlotSnapshot {
  try {
    const s = JSON.parse(raw) as Partial<SlotSnapshot>;
    return {
      start: typeof s.start === 'string' ? s.start : '',
      end: typeof s.end === 'string' ? s.end : '',
      roleId: typeof s.roleId === 'number' ? s.roleId : null,
      resourceId: typeof s.resourceId === 'number' ? s.resourceId : null,
    };
  } catch {
    console.warn('[shifts] Unparseable slot_snapshot, returning empty snapshot');
    return { start: '', end: '', roleId: null, resourceId: null };
  }
}

function mapCoverRequest(row: CoverRequestRow): CoverRequest {
  return {
    id: row.id,
    slotId: row.slot_id,
    companyId: row.company_id,
    fromEmployeeId: row.from_employee_id,
    toEmployeeId: row.to_employee_id,
    askAll: row.ask_all === 1,
    acceptedByEmployeeId: row.accepted_by_employee_id,
    message: row.message,
    status: row.status,
    slotSnapshot: parseSnapshot(row.slot_snapshot),
    answerDeadline: row.answer_deadline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedByEmployeeId: row.decided_by_employee_id,
    decidedAt: row.decided_at,
  };
}

/**
 * Create a cover request in status 'pending_teammate'.
 * Uniqueness of the active request per slot is enforced by the partial unique
 * index — a concurrent duplicate returns { ok: false, error: 'active_exists' }.
 */
export function createCoverRequest(v: {
  slotId: number;
  companyId: number;
  fromEmployeeId: number;
  toEmployeeId: number | null;
  askAll: boolean;
  message: string | null;
  slotSnapshot: SlotSnapshot;
  answerDeadline: string;
}): { ok: true; id: number } | { ok: false; error: 'active_exists' } {
  ensureTables();
  const now = nowISO();
  try {
    const result = getDb().prepare(`
      INSERT INTO shift_cover_requests
        (slot_id, company_id, from_employee_id, to_employee_id, ask_all, message, status, slot_snapshot, answer_deadline, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending_teammate', ?, ?, ?, ?)
    `).run(
      v.slotId,
      v.companyId,
      v.fromEmployeeId,
      v.toEmployeeId,
      v.askAll ? 1 : 0,
      v.message,
      JSON.stringify(v.slotSnapshot),
      v.answerDeadline,
      now,
      now,
    );
    return { ok: true, id: result.lastInsertRowid as number };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code || '';
    const msg = err instanceof Error ? err.message : String(err);
    if (code.startsWith('SQLITE_CONSTRAINT') || msg.includes('UNIQUE constraint failed')) {
      return { ok: false, error: 'active_exists' };
    }
    throw err;
  }
}

/**
 * Compare-and-swap transition: UPDATE … WHERE id = ? AND status IN (…).
 * Returns true only when exactly one row changed. False means the state moved
 * underneath the caller — reload and surface the real state, never overwrite.
 */
export function casTransition(
  id: number,
  fromStatus: string | string[],
  toStatus: string,
  extra?: Partial<{ acceptedByEmployeeId: number; decidedByEmployeeId: number }>,
): boolean {
  ensureTables();
  const froms = Array.isArray(fromStatus) ? fromStatus : [fromStatus];
  if (froms.length === 0) return false;
  const now = nowISO();
  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const vals: (string | number)[] = [toStatus, now];
  if (extra?.acceptedByEmployeeId !== undefined) {
    sets.push('accepted_by_employee_id = ?');
    vals.push(extra.acceptedByEmployeeId);
  }
  if (extra?.decidedByEmployeeId !== undefined) {
    sets.push('decided_by_employee_id = ?', 'decided_at = ?');
    vals.push(extra.decidedByEmployeeId, now);
  }
  const placeholders = froms.map(() => '?').join(',');
  const result = getDb()
    .prepare(`UPDATE shift_cover_requests SET ${sets.join(', ')} WHERE id = ? AND status IN (${placeholders})`)
    .run(...vals, id, ...froms);
  return result.changes === 1;
}

export function getCoverRequest(id: number): CoverRequest | null {
  ensureTables();
  const row = getDb()
    .prepare('SELECT * FROM shift_cover_requests WHERE id = ?')
    .get(id) as CoverRequestRow | undefined;
  return row ? mapCoverRequest(row) : null;
}

/** The single active (pending) request for a slot, if any. */
export function getActiveCoverRequestForSlot(slotId: number): CoverRequest | null {
  ensureTables();
  const row = getDb()
    .prepare(
      "SELECT * FROM shift_cover_requests WHERE slot_id = ? AND status IN ('pending_teammate','pending_manager')"
    )
    .get(slotId) as CoverRequestRow | undefined;
  return row ? mapCoverRequest(row) : null;
}

/**
 * List cover requests with optional filters.
 * involvingEmployeeId matches requester, direct target, acceptor, or any
 * ask-all request (routes post-filter ask-all rows by live role eligibility).
 */
export function listCoverRequests(f: {
  companyId?: number;
  status?: string[];
  fromEmployeeId?: number;
  involvingEmployeeId?: number;
  limit?: number;
}): CoverRequest[] {
  ensureTables();
  const where: string[] = [];
  const vals: (string | number)[] = [];
  if (f.companyId !== undefined) {
    where.push('company_id = ?');
    vals.push(f.companyId);
  }
  if (f.status && f.status.length > 0) {
    where.push(`status IN (${f.status.map(() => '?').join(',')})`);
    vals.push(...f.status);
  }
  if (f.fromEmployeeId !== undefined) {
    where.push('from_employee_id = ?');
    vals.push(f.fromEmployeeId);
  }
  if (f.involvingEmployeeId !== undefined) {
    where.push('(from_employee_id = ? OR to_employee_id = ? OR accepted_by_employee_id = ? OR ask_all = 1)');
    vals.push(f.involvingEmployeeId, f.involvingEmployeeId, f.involvingEmployeeId);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = f.limit ?? 100;
  const rows = getDb()
    .prepare(`SELECT * FROM shift_cover_requests ${clause} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...vals, limit) as CoverRequestRow[];
  return rows.map(mapCoverRequest);
}

// -- Sick reports -----------------------------------------------------------------

interface SickReportRow {
  id: number;
  slot_id: number;
  company_id: number;
  employee_id: number;
  note: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_action: string | null;
}

function mapSickReport(row: SickReportRow): SickReport {
  return {
    id: row.id,
    slotId: row.slot_id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    note: row.note,
    status: row.status === 'resolved' ? 'resolved' : 'open',
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedAction: (row.resolved_action as SickReport['resolvedAction']) ?? null,
  };
}

export function createSickReport(v: {
  slotId: number;
  companyId: number;
  employeeId: number;
  note: string | null;
}): number {
  ensureTables();
  const result = getDb().prepare(`
    INSERT INTO shift_sick_reports (slot_id, company_id, employee_id, note, status, created_at)
    VALUES (?, ?, ?, ?, 'open', ?)
  `).run(v.slotId, v.companyId, v.employeeId, v.note, nowISO());
  return result.lastInsertRowid as number;
}

export function listSickReports(companyId: number, status?: string): SickReport[] {
  ensureTables();
  const vals: (string | number)[] = [companyId];
  let clause = 'WHERE company_id = ?';
  if (status) {
    clause += ' AND status = ?';
    vals.push(status);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM shift_sick_reports ${clause} ORDER BY created_at DESC, id DESC`)
    .all(...vals) as SickReportRow[];
  return rows.map(mapSickReport);
}

/** CAS open → resolved. Returns false if the report was already resolved. */
export function resolveSickReport(id: number, action: 'reopened' | 'kept'): boolean {
  ensureTables();
  const result = getDb()
    .prepare(
      "UPDATE shift_sick_reports SET status = 'resolved', resolved_at = ?, resolved_action = ? WHERE id = ? AND status = 'open'"
    )
    .run(nowISO(), action, id);
  return result.changes === 1;
}

// -- Notifications ------------------------------------------------------------------

interface NotificationRow {
  id: number;
  employee_id: number;
  company_id: number;
  type: string;
  payload: string;
  read_at: string | null;
  created_at: string;
}

function mapNotification(row: NotificationRow): ShiftNotification {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    console.warn('[shifts] Unparseable notification payload, id', row.id);
  }
  return {
    id: row.id,
    employeeId: row.employee_id,
    companyId: row.company_id,
    type: row.type,
    payload,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function addNotification(v: {
  employeeId: number;
  companyId: number;
  type: string;
  payload: object;
}): void {
  ensureTables();
  getDb().prepare(`
    INSERT INTO shift_notifications (employee_id, company_id, type, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(v.employeeId, v.companyId, v.type, JSON.stringify(v.payload), nowISO());
}

export function listNotifications(employeeId: number, limit?: number): ShiftNotification[] {
  ensureTables();
  const rows = getDb()
    .prepare('SELECT * FROM shift_notifications WHERE employee_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(employeeId, limit ?? 50) as NotificationRow[];
  return rows.map(mapNotification);
}

export function markNotificationsRead(employeeId: number, ids: number[]): void {
  ensureTables();
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  getDb()
    .prepare(
      `UPDATE shift_notifications SET read_at = ? WHERE employee_id = ? AND read_at IS NULL AND id IN (${placeholders})`
    )
    .run(nowISO(), employeeId, ...ids);
}

// -- Shift templates (reusable "quick start" shifts) ----------------------------

interface TemplateRow {
  id: number;
  company_id: number;
  name: string;
  start_hhmm: string;
  end_hhmm: string;
  role_id: number | null;
  headcount: number;
  min_skill: string | null;
  created_at: string;
}

function mapTemplate(r: TemplateRow): ShiftTemplate {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    startHHMM: r.start_hhmm,
    endHHMM: r.end_hhmm,
    roleId: r.role_id,
    headcount: r.headcount,
    minSkill: r.min_skill === '2' || r.min_skill === '3' ? r.min_skill : null,
    createdAt: r.created_at,
  };
}

/** All templates for a company, newest first. */
export function listShiftTemplates(companyId: number): ShiftTemplate[] {
  ensureTables();
  const rows = getDb()
    .prepare('SELECT * FROM shift_templates WHERE company_id = ? ORDER BY id DESC')
    .all(companyId) as TemplateRow[];
  return rows.map(mapTemplate);
}

/** Create a template; returns the new id. */
export function createShiftTemplate(v: {
  companyId: number;
  name: string;
  startHHMM: string;
  endHHMM: string;
  roleId: number | null;
  headcount: number;
  minSkill?: string | null;
}): number {
  ensureTables();
  const minSkill = v.minSkill === '2' || v.minSkill === '3' ? v.minSkill : null;
  const info = getDb()
    .prepare(
      `INSERT INTO shift_templates (company_id, name, start_hhmm, end_hhmm, role_id, headcount, min_skill, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.companyId, v.name, v.startHHMM, v.endHHMM, v.roleId, v.headcount, minSkill, nowISO());
  return Number(info.lastInsertRowid);
}

/** Delete a template, scoped to its company. Returns true if a row was removed. */
export function deleteShiftTemplate(id: number, companyId: number): boolean {
  ensureTables();
  const info = getDb()
    .prepare('DELETE FROM shift_templates WHERE id = ? AND company_id = ?')
    .run(id, companyId);
  return info.changes > 0;
}

// -- Shift patterns (reusable weekly stencils) + publish runs -------------------

interface PatternRow {
  id: number;
  company_id: number;
  name: string;
  active: number;
  created_at: string;
}
interface PatternLineRow {
  id: number;
  pattern_id: number;
  weekday: number;
  start_hhmm: string;
  end_hhmm: string;
  role_id: number | null;
  department_id: number | null;
  headcount: number;
  min_skill: string | null;
}

function mapPatternLine(r: PatternLineRow): ShiftPatternLine {
  return {
    weekday: r.weekday,
    startHHMM: r.start_hhmm,
    endHHMM: r.end_hhmm,
    roleId: r.role_id,
    departmentId: r.department_id,
    headcount: r.headcount,
    minSkill: r.min_skill === '2' || r.min_skill === '3' ? r.min_skill : null,
  };
}

function insertPatternLines(patternId: number, lines: ShiftPatternLine[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO shift_pattern_line
       (pattern_id, weekday, start_hhmm, end_hhmm, role_id, department_id, headcount, min_skill)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  for (const l of lines) {
    stmt.run(
      patternId,
      l.weekday,
      l.startHHMM,
      l.endHHMM,
      l.roleId,
      l.departmentId,
      Math.max(1, Math.min(20, l.headcount || 1)),
      l.minSkill,
    );
  }
}

/** Create a pattern with its lines in one transaction; returns the new id. */
export function createPattern(v: { companyId: number; name: string; lines: ShiftPatternLine[] }): number {
  ensureTables();
  const db = getDb();
  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO shift_pattern (company_id, name, active, created_at) VALUES (?,?,1,?)')
      .run(v.companyId, v.name, nowISO());
    const id = Number(info.lastInsertRowid);
    insertPatternLines(id, v.lines);
    return id;
  });
  return tx();
}

/** Active patterns for a company (newest first), each with its lines. */
export function listPatterns(companyId: number): ShiftPattern[] {
  ensureTables();
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM shift_pattern WHERE company_id=? AND active=1 ORDER BY id DESC')
    .all(companyId) as PatternRow[];
  return rows.map(r => ({
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    active: r.active === 1,
    createdAt: r.created_at,
    lines: (
      db
        .prepare('SELECT * FROM shift_pattern_line WHERE pattern_id=? ORDER BY weekday, start_hhmm')
        .all(r.id) as PatternLineRow[]
    ).map(mapPatternLine),
  }));
}

/** One pattern with its lines, scoped to its company; null if not found. */
export function getPattern(id: number, companyId: number): ShiftPattern | null {
  ensureTables();
  const db = getDb();
  const r = db
    .prepare('SELECT * FROM shift_pattern WHERE id=? AND company_id=?')
    .get(id, companyId) as PatternRow | undefined;
  if (!r) return null;
  const lines = (
    db
      .prepare('SELECT * FROM shift_pattern_line WHERE pattern_id=? ORDER BY weekday, start_hhmm')
      .all(id) as PatternLineRow[]
  ).map(mapPatternLine);
  return { id: r.id, companyId: r.company_id, name: r.name, active: r.active === 1, createdAt: r.created_at, lines };
}

/** Rename + replace all lines of a pattern in one transaction. */
export function replacePatternLines(
  id: number,
  companyId: number,
  name: string,
  lines: ShiftPatternLine[],
): boolean {
  ensureTables();
  const db = getDb();
  const tx = db.transaction(() => {
    const upd = db.prepare('UPDATE shift_pattern SET name=? WHERE id=? AND company_id=?').run(name, id, companyId);
    if (upd.changes !== 1) return false;
    db.prepare('DELETE FROM shift_pattern_line WHERE pattern_id=?').run(id);
    insertPatternLines(id, lines);
    return true;
  });
  return tx();
}

/** Soft-delete a pattern (active=0). Returns true if a row was updated. */
export function deletePattern(id: number, companyId: number): boolean {
  ensureTables();
  const info = getDb()
    .prepare('UPDATE shift_pattern SET active=0 WHERE id=? AND company_id=?')
    .run(id, companyId);
  return info.changes === 1;
}

interface RunRow {
  id: number;
  company_id: number;
  pattern_id: number | null;
  week_key: string;
  select_deadline: string;
  state: string;
  created_at: string;
}
function mapRun(r: RunRow): ShiftPublishRun {
  const st: PublishRunState =
    r.state === 'locked' || r.state === 'finalized' ? r.state : 'open';
  return {
    id: r.id,
    companyId: r.company_id,
    patternId: r.pattern_id,
    weekKey: r.week_key,
    selectDeadline: r.select_deadline,
    state: st,
    createdAt: r.created_at,
  };
}

/** Record a publish: pattern → week, with the staff-selection deadline. */
export function createPublishRun(v: {
  companyId: number;
  patternId: number | null;
  weekKey: string;
  selectDeadline: string;
}): number {
  ensureTables();
  const info = getDb()
    .prepare(
      `INSERT INTO shift_publish_run (company_id, pattern_id, week_key, select_deadline, state, created_at)
       VALUES (?,?,?,?,'open',?)`,
    )
    .run(v.companyId, v.patternId, v.weekKey, v.selectDeadline, nowISO());
  return Number(info.lastInsertRowid);
}

/** Map generated slot ids to a run (for lock/gaps/cleanup). Idempotent. */
export function recordPublishSlots(runId: number, slotIds: number[]): void {
  if (slotIds.length === 0) return;
  ensureTables();
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO shift_publish_slot (run_id, slot_id) VALUES (?,?)');
  const tx = db.transaction((ids: number[]) => {
    for (const s of ids) stmt.run(runId, s);
  });
  tx(slotIds);
}

/** All publish runs for a company, newest first. */
export function listPublishRuns(companyId: number): ShiftPublishRun[] {
  ensureTables();
  return (
    getDb().prepare('SELECT * FROM shift_publish_run WHERE company_id=? ORDER BY id DESC').all(companyId) as RunRow[]
  ).map(mapRun);
}

/** One publish run, scoped to its company; null if not found. */
export function getPublishRun(id: number, companyId: number): ShiftPublishRun | null {
  ensureTables();
  const r = getDb()
    .prepare('SELECT * FROM shift_publish_run WHERE id=? AND company_id=?')
    .get(id, companyId) as RunRow | undefined;
  return r ? mapRun(r) : null;
}

/** slot ids generated by a run. */
export function publishRunSlotIds(runId: number): number[] {
  ensureTables();
  return (
    getDb().prepare('SELECT slot_id FROM shift_publish_slot WHERE run_id=?').all(runId) as { slot_id: number }[]
  ).map(x => x.slot_id);
}

/** Set a run's lifecycle state. Returns true if a row changed. */
export function setPublishRunState(id: number, companyId: number, state: PublishRunState): boolean {
  ensureTables();
  return (
    getDb().prepare('UPDATE shift_publish_run SET state=? WHERE id=? AND company_id=?').run(state, id, companyId)
      .changes === 1
  );
}

/** Move a run's selection deadline. Returns true if a row changed. */
export function setPublishRunDeadline(id: number, companyId: number, selectDeadline: string): boolean {
  ensureTables();
  return (
    getDb()
      .prepare('UPDATE shift_publish_run SET select_deadline=? WHERE id=? AND company_id=?')
      .run(selectDeadline, id, companyId).changes === 1
  );
}

// -- Weekend rule: per-company on/off + per-person history (grandfather guard) --

/** Is the "weekend shifts first" rule on for this company? Default: on. */
export function getWeekendEnabled(companyId: number): boolean {
  ensureTables();
  const row = getDb()
    .prepare('SELECT enabled FROM shift_weekend_config WHERE company_id=?')
    .get(companyId) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : true;
}

export function setWeekendEnabled(companyId: number, on: boolean): void {
  ensureTables();
  getDb()
    .prepare(
      `INSERT INTO shift_weekend_config (company_id, enabled, updated_at) VALUES (?,?,?)
       ON CONFLICT(company_id) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at`,
    )
    .run(companyId, on ? 1 : 0, nowISO());
}

/** When (if ever) this person first met their weekend quota for the period. */
export function weekendGateUnlockedAt(companyId: number, employeeId: number, periodKey: string): string | null {
  ensureTables();
  const row = getDb()
    .prepare(
      'SELECT gate_unlocked_at FROM shift_weekend_history WHERE company_id=? AND employee_id=? AND period_key=?',
    )
    .get(companyId, employeeId, periodKey) as { gate_unlocked_at: string | null } | undefined;
  return row?.gate_unlocked_at ?? null;
}

/**
 * Record a person's weekend snapshot for a period. gate_unlocked_at is set once
 * (the first time gateUnlocked is true) and never cleared — the grandfather
 * guard, so meeting the bar once can't be undone by others' actions.
 */
export function upsertWeekendHistory(v: {
  companyId: number;
  employeeId: number;
  periodKey: string;
  quotaRequired: number;
  weekendWorked: number;
  gateUnlocked: boolean;
}): void {
  ensureTables();
  const now = nowISO();
  getDb()
    .prepare(
      `INSERT INTO shift_weekend_history
         (company_id, employee_id, period_key, quota_required, weekend_worked, gate_unlocked_at, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(company_id, employee_id, period_key) DO UPDATE SET
         quota_required=excluded.quota_required,
         weekend_worked=excluded.weekend_worked,
         gate_unlocked_at=COALESCE(shift_weekend_history.gate_unlocked_at, excluded.gate_unlocked_at),
         updated_at=excluded.updated_at`,
    )
    .run(v.companyId, v.employeeId, v.periodKey, v.quotaRequired, v.weekendWorked, v.gateUnlocked ? now : null, now);
}

/** Total weekend shifts each employee worked across the given periods (fairness scorecard). */
export function weekendWorkedByEmployee(companyId: number, periodKeys: string[]): Map<number, number> {
  ensureTables();
  const map = new Map<number, number>();
  if (periodKeys.length === 0) return map;
  const ph = periodKeys.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT employee_id, SUM(weekend_worked) AS total FROM shift_weekend_history
       WHERE company_id=? AND period_key IN (${ph}) GROUP BY employee_id`,
    )
    .all(companyId, ...periodKeys) as { employee_id: number; total: number }[];
  for (const r of rows) map.set(r.employee_id, r.total);
  return map;
}

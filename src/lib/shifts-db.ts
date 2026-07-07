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
import type {
  CoverRequest,
  ShiftNotification,
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

    CREATE TABLE IF NOT EXISTS shift_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_hhmm TEXT NOT NULL,
      end_hhmm TEXT NOT NULL,
      role_id INTEGER,
      headcount INTEGER NOT NULL DEFAULT 1,
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
  `);
  _initialized = true;
}

// -- Slot minimum skill (open shifts: only ≥ level staff may claim) --------------

/**
 * Set (or clear, when minSkill is null) the minimum skill level required to
 * claim an open slot. '1' (Trainee = anyone) is treated as no requirement and
 * clears the row; store only '2' (Associate+) or '3' (Team Lead).
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

/** Set (empty/null clears) a staff member's kiosk PIN. */
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

// -- Settings -------------------------------------------------------------------

interface SettingsRow {
  company_id: number;
  require_approval: number;
  answer_deadline_hours: number;
  settle_buffer_hours: number;
  allow_ask_all: number;
  allow_sick_report: number;
}

/** Per-company shift settings. Missing row → defaults 1/12/2/1/1. */
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
    };
  }
  return {
    companyId: row.company_id,
    requireApproval: row.require_approval === 1,
    answerDeadlineHours: row.answer_deadline_hours,
    settleBufferHours: row.settle_buffer_hours,
    allowAskAll: row.allow_ask_all === 1,
    allowSickReport: row.allow_sick_report === 1,
  };
}

export function saveShiftSettings(s: ShiftSettings): void {
  ensureTables();
  getDb().prepare(`
    INSERT INTO shift_settings (company_id, require_approval, answer_deadline_hours, settle_buffer_hours, allow_ask_all, allow_sick_report, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
      require_approval = excluded.require_approval,
      answer_deadline_hours = excluded.answer_deadline_hours,
      settle_buffer_hours = excluded.settle_buffer_hours,
      allow_ask_all = excluded.allow_ask_all,
      allow_sick_report = excluded.allow_sick_report,
      updated_at = excluded.updated_at
  `).run(
    s.companyId,
    s.requireApproval ? 1 : 0,
    s.answerDeadlineHours,
    s.settleBufferHours,
    s.allowAskAll ? 1 : 0,
    s.allowSickReport ? 1 : 0,
    nowISO(),
  );
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
}): number {
  ensureTables();
  const info = getDb()
    .prepare(
      `INSERT INTO shift_templates (company_id, name, start_hhmm, end_hhmm, role_id, headcount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.companyId, v.name, v.startHHMM, v.endHHMM, v.roleId, v.headcount, nowISO());
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

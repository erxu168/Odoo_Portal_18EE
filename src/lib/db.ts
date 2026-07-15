/**
 * Portal SQLite database — stores users, sessions, and password reset tokens.
 * Odoo remains the single source of truth for business data.
 * This DB only handles portal authentication.
 *
 * DB file location: ./data/portal.db (gitignored)
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';

const DB_PATH = path.join(process.cwd(), 'data', 'portal.db');

let _db: Database.Database | null = null;

function nowISO(): string {
  return new Date().toISOString();
}

export function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initTables(_db);
    migrateSchema(_db);
    seedAdmin(_db);
  }
  return _db;
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      employee_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      active INTEGER NOT NULL DEFAULT 1,
      login_count INTEGER NOT NULL DEFAULT 0,
      tour_seen INTEGER NOT NULL DEFAULT 0,
      allowed_company_ids TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      station_device_id INTEGER   -- set for shared-tablet sessions; enables per-device revoke
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registration_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_or_identifier TEXT NOT NULL,
      attempted_at TEXT NOT NULL
    );

    -- Server-minted "who's acting" token for a shared kitchen tablet: proves a
    -- PIN was verified. Bound to the exact tablet LOGIN SESSION (station_session)
    -- so it can't be forged, replayed from another session, or reused after
    -- logout/relogin. The FK cascade auto-revokes it when that session ends.
    CREATE TABLE IF NOT EXISTS station_actors (
      token TEXT PRIMARY KEY,
      station_session TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
      station_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      acting_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      acting_employee_id INTEGER,
      company_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON portal_users(email);
    CREATE INDEX IF NOT EXISTS idx_users_employee ON portal_users(employee_id);
    CREATE INDEX IF NOT EXISTS idx_users_status ON portal_users(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_reg_attempts ON registration_attempts(ip_or_identifier, attempted_at);
    CREATE INDEX IF NOT EXISTS idx_station_actors_expires ON station_actors(expires_at);

    -- A provisioned shared tablet (one-time manager setup). Holds a long-lived
    -- device credential bound to a restaurant's shared "station" account so the
    -- tablet can show a PIN-only login. The raw token lives in an httpOnly cookie;
    -- only its sha256 hash is stored here. Revocable ("un-setup").
    CREATE TABLE IF NOT EXISTS station_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      station_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL,
      label TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,   -- consecutive wrong PINs (persistent brute-force lockout)
      locked_until TEXT                        -- ISO; while > now, PIN login is refused
    );
    CREATE INDEX IF NOT EXISTS idx_station_devices_token ON station_devices(token_hash);

    CREATE TABLE IF NOT EXISTS portal_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    );

    -- Per-company settings (email/SMTP now; branding, notifications, etc. later).
    -- company_id = 0 is the shared "default (all restaurants)" fallback.
    CREATE TABLE IF NOT EXISTS company_settings (
      company_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (company_id, key)
    );

    -- Admin overrides for per-action permissions. action_key missing = use registry default.
    CREATE TABLE IF NOT EXISTS feature_permissions (
      action_key TEXT PRIMARY KEY,
      allowed_roles TEXT NOT NULL,   -- JSON array subset of ["staff","manager","admin"]
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS bom_tolerance (
      bom_id INTEGER PRIMARY KEY,
      tolerance_pct REAL NOT NULL DEFAULT 5,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS portal_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invites_employee ON portal_invites(employee_id);
    CREATE INDEX IF NOT EXISTS idx_invites_token ON portal_invites(token_hash);
  `);
}

/**
 * Migrate existing DBs that lack new columns.
 */
function migrateSchema(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info('portal_users')").all() as { name: string }[];
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('status')) {
    db.exec("ALTER TABLE portal_users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!colNames.includes('login_count')) {
    db.exec('ALTER TABLE portal_users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!colNames.includes('tour_seen')) {
    db.exec('ALTER TABLE portal_users ADD COLUMN tour_seen INTEGER NOT NULL DEFAULT 0');
  }
  if (!colNames.includes('allowed_company_ids')) {
    db.exec("ALTER TABLE portal_users ADD COLUMN allowed_company_ids TEXT DEFAULT '[]'");
  }
  if (!colNames.includes('applicant_id')) {
    db.exec('ALTER TABLE portal_users ADD COLUMN applicant_id INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_applicant ON portal_users(applicant_id)');
  }
  if (!colNames.includes('must_change_password')) {
    db.exec('ALTER TABLE portal_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
  if (!colNames.includes('preferences')) {
    db.exec("ALTER TABLE portal_users ADD COLUMN preferences TEXT DEFAULT '{}'");
  }
  // Per-user module allowlist (JSON array of module ids). NULL = use role default.
  if (!colNames.includes('module_access')) {
    try {
      db.exec('ALTER TABLE portal_users ADD COLUMN module_access TEXT DEFAULT NULL');
    } catch (e) {
      // A concurrent process (e.g. a parallel build worker) may have added it first.
      if (!String((e as Error)?.message).includes('duplicate column')) throw e;
    }
  }
  // 4-digit PIN (hashed) for "Working as" attribution on shared devices.
  if (!colNames.includes('pin_hash')) {
    try { db.exec('ALTER TABLE portal_users ADD COLUMN pin_hash TEXT DEFAULT NULL'); }
    catch (e) { if (!String((e as Error)?.message).includes('duplicate column')) throw e; }
  }
  // Marks a login as a shared/department device (kitchen tablet) rather than a person.
  if (!colNames.includes('is_shared_device')) {
    try { db.exec('ALTER TABLE portal_users ADD COLUMN is_shared_device INTEGER NOT NULL DEFAULT 0'); }
    catch (e) { if (!String((e as Error)?.message).includes('duplicate column')) throw e; }
  }

  // station_actors gained `station_session`. The table only holds transient acting
  // tokens, so if an older shape exists just drop + recreate it (worst case: active
  // tablet users re-enter their PIN). Without this, INSERTs would fail on old DBs.
  try {
    const saCols = db.prepare('PRAGMA table_info(station_actors)').all() as { name: string }[];
    if (saCols.length > 0 && !saCols.some(c => c.name === 'station_session')) {
      db.exec('DROP TABLE station_actors');
      db.exec(`CREATE TABLE station_actors (
        token TEXT PRIMARY KEY,
        station_session TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
        station_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        acting_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        acting_employee_id INTEGER,
        company_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_station_actors_expires ON station_actors(expires_at)');
    }
  } catch { /* table absent or already current */ }

  // sessions gained station_device_id (per-tablet-device session revocation).
  try {
    const sCols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    if (sCols.length > 0 && !sCols.some(c => c.name === 'station_device_id')) {
      db.exec('ALTER TABLE sessions ADD COLUMN station_device_id INTEGER');
    }
    // At most one active session per provisioned device (DB-enforced; NULLs — i.e.
    // normal user sessions — are exempt from the uniqueness).
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_device ON sessions(station_device_id) WHERE station_device_id IS NOT NULL');
  } catch { /* ignore */ }

  // station_devices gained the persistent PIN-lockout columns.
  try {
    const sdCols = db.prepare('PRAGMA table_info(station_devices)').all() as { name: string }[];
    if (sdCols.length > 0) {
      if (!sdCols.some(c => c.name === 'fail_count')) {
        db.exec('ALTER TABLE station_devices ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0');
      }
      if (!sdCols.some(c => c.name === 'locked_until')) {
        db.exec('ALTER TABLE station_devices ADD COLUMN locked_until TEXT');
      }
    }
  } catch { /* table absent — initTables creates it with the columns */ }
}

function seedAdmin(db: Database.Database) {
  const row = db.prepare('SELECT COUNT(*) as c FROM portal_users').get() as { c: number };
  if (row.c === 0) {
    const email = process.env.ODOO_USER || 'biz@krawings.de';
    const hash = bcrypt.hashSync('test1234', 10);
    db.prepare(
      "INSERT INTO portal_users (name, email, password_hash, role, status, allowed_company_ids, created_at) VALUES (?, ?, ?, ?, 'active', '[]', ?)"
    ).run('Admin', email, hash, 'admin', nowISO());
    console.log(`Portal: created initial admin user (${email}). Change the password!`);
  }
}

// -- User CRUD --

export interface PortalUser {
  id: number;
  name: string;
  email: string;
  role: 'staff' | 'manager' | 'admin';
  employee_id: number | null;
  applicant_id: number | null;
  must_change_password: number;
  status: string;
  active: number;
  login_count: number;
  tour_seen: number;
  allowed_company_ids: string;
  preferences: string;
  module_access: string | null;
  is_shared_device: number;
  has_pin?: number;
  created_at: string;
  last_login: string | null;
}

export function parseCompanyIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.filter(Number.isFinite) : []; }
  catch { return []; }
}

export function getUserByEmail(email: string): PortalUser & { password_hash: string } | null {
  const db = getDb();
  return db.prepare('SELECT * FROM portal_users WHERE email = ? AND active = 1').get(email) as (PortalUser & { password_hash: string }) | null;
}

export function getUserByEmployeeId(employeeId: number): PortalUser | null {
  const db = getDb();
  return db.prepare('SELECT * FROM portal_users WHERE employee_id = ? AND active = 1').get(employeeId) as PortalUser | null;
}

export function getUserByApplicantId(applicantId: number): PortalUser | null {
  const db = getDb();
  return db.prepare('SELECT * FROM portal_users WHERE applicant_id = ? AND active = 1').get(applicantId) as PortalUser | null;
}

/**
 * Look up the portal account for an employee regardless of active state, with the
 * computed has_pin flag. Unlike getUserByEmployeeId (which filters active = 1),
 * this surfaces deactivated accounts so they can be reactivated.
 */
export function getAccountByEmployeeId(employeeId: number): PortalUser | null {
  const db = getDb();
  // Prefer an active account, then the most recent, so that if an employee ever
  // ends up with both a deactivated and a live account we surface the live one.
  return db.prepare('SELECT id, name, email, role, employee_id, applicant_id, must_change_password, status, active, login_count, tour_seen, allowed_company_ids, module_access, is_shared_device, (pin_hash IS NOT NULL) AS has_pin, created_at, last_login FROM portal_users WHERE employee_id = ? ORDER BY active DESC, created_at DESC LIMIT 1').get(employeeId) as PortalUser | null;
}

/**
 * Existence check by email that ignores active state (email is UNIQUE COLLATE
 * NOCASE across ALL rows, active or not). Use before creating an account so a
 * deactivated row holding the same email produces a friendly error rather than a
 * UNIQUE-constraint 500.
 */
export function getAnyUserByEmail(email: string): PortalUser | null {
  const db = getDb();
  return db.prepare('SELECT id, name, email, role, employee_id, active, status FROM portal_users WHERE email = ? COLLATE NOCASE LIMIT 1').get(email) as PortalUser | null;
}

export function getUserById(id: number): PortalUser | null {
  const db = getDb();
  return db.prepare('SELECT id, name, email, role, employee_id, applicant_id, must_change_password, status, active, login_count, tour_seen, allowed_company_ids, module_access, is_shared_device, (pin_hash IS NOT NULL) AS has_pin, created_at, last_login FROM portal_users WHERE id = ?').get(id) as PortalUser | null;
}

export function listUsers(): PortalUser[] {
  const db = getDb();
  return db.prepare('SELECT id, name, email, role, employee_id, applicant_id, must_change_password, status, active, login_count, tour_seen, allowed_company_ids, module_access, is_shared_device, (pin_hash IS NOT NULL) AS has_pin, created_at, last_login FROM portal_users ORDER BY created_at DESC').all() as PortalUser[];
}

export function listUsersByStatus(status: string): PortalUser[] {
  const db = getDb();
  return db.prepare('SELECT id, name, email, role, employee_id, applicant_id, must_change_password, status, active, login_count, tour_seen, allowed_company_ids, module_access, is_shared_device, (pin_hash IS NOT NULL) AS has_pin, created_at, last_login FROM portal_users WHERE status = ? AND active = 1 ORDER BY created_at DESC').all(status) as PortalUser[];
}

export function countUsersByStatus(status: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as c FROM portal_users WHERE status = ? AND active = 1').get(status) as { c: number };
  return row.c;
}

export function createUser(name: string, email: string, password: string, role: string, extra?: { employee_id?: number; applicant_id?: number; status?: string; allowed_company_ids?: number[]; must_change_password?: boolean }): number {
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  const status = extra?.status || 'active';
  const employeeId = extra?.employee_id || null;
  const applicantId = extra?.applicant_id || null;
  const mustChange = extra?.must_change_password ? 1 : 0;
  const companyIds = JSON.stringify(extra?.allowed_company_ids || []);
  const result = db.prepare(
    'INSERT INTO portal_users (name, email, password_hash, role, employee_id, applicant_id, must_change_password, status, allowed_company_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, email.toLowerCase().trim(), hash, role, employeeId, applicantId, mustChange, status, companyIds, nowISO());
  return result.lastInsertRowid as number;
}

/**
 * Hard-delete a portal account and its sessions. Frees the account's (UNIQUE)
 * email + its employee_id so the person can be invited from scratch again.
 * Does NOT touch the Odoo hr.employee record. Sessions are removed explicitly
 * because better-sqlite3 doesn't enforce ON DELETE CASCADE by default.
 */
export function deleteUser(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM portal_users WHERE id = ?').run(id);
}

export function updateUser(id: number, updates: { name?: string; role?: string; active?: number; employee_id?: number | null; applicant_id?: number | null; must_change_password?: number; status?: string; allowed_company_ids?: number[]; module_access?: string[] | null; is_shared_device?: number }) {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.role !== undefined) { sets.push('role = ?'); vals.push(updates.role); }
  if (updates.active !== undefined) { sets.push('active = ?'); vals.push(updates.active); }
  if (updates.employee_id !== undefined) { sets.push('employee_id = ?'); vals.push(updates.employee_id); }
  if (updates.applicant_id !== undefined) { sets.push('applicant_id = ?'); vals.push(updates.applicant_id); }
  if (updates.must_change_password !== undefined) { sets.push('must_change_password = ?'); vals.push(updates.must_change_password); }
  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
  if (updates.allowed_company_ids !== undefined) { sets.push('allowed_company_ids = ?'); vals.push(JSON.stringify(updates.allowed_company_ids)); }
  if (updates.module_access !== undefined) { sets.push('module_access = ?'); vals.push(updates.module_access === null ? null : JSON.stringify(updates.module_access)); }
  if (updates.is_shared_device !== undefined) { sets.push('is_shared_device = ?'); vals.push(updates.is_shared_device ? 1 : 0); }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE portal_users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/** Set (or clear, if pin is empty) a user's 4-digit attribution PIN. */
export function setUserPin(id: number, pin: string | null) {
  const db = getDb();
  const hash = pin ? bcrypt.hashSync(pin, 10) : null;
  db.prepare('UPDATE portal_users SET pin_hash = ? WHERE id = ?').run(hash, id);
}

/** Verify a PIN for a specific user. */
export function verifyUserPin(id: number, pin: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT pin_hash FROM portal_users WHERE id = ? AND active = 1 AND status = 'active'").get(id) as { pin_hash: string | null } | undefined;
  if (!row || !row.pin_hash) return false;
  return bcrypt.compareSync(pin, row.pin_hash);
}

/** Personal staff (with a PIN set) who can sign in on a shared device in this company. */
export function listShiftStaff(companyId: number): { id: number; name: string }[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, name, role, allowed_company_ids FROM portal_users WHERE active = 1 AND status = 'active' AND is_shared_device = 0 AND pin_hash IS NOT NULL ORDER BY name"
  ).all() as { id: number; name: string; role: string; allowed_company_ids: string }[];
  return rows
    .filter(r => r.role === 'admin' || parseCompanyIds(r.allowed_company_ids).includes(companyId))
    .map(r => ({ id: r.id, name: r.name }));
}

export function updateUserPreferences(id: number, prefs: Record<string, any>) {
  const db = getDb();
  // Merge with existing preferences
  const user = db.prepare('SELECT preferences FROM portal_users WHERE id = ?').get(id) as { preferences: string } | undefined;
  let existing: Record<string, any> = {};
  try { existing = JSON.parse(user?.preferences || '{}'); } catch { /* ignore */ }
  const merged = { ...existing, ...prefs };
  db.prepare('UPDATE portal_users SET preferences = ? WHERE id = ?').run(JSON.stringify(merged), id);
}

export function resetPassword(id: number, newPassword: string) {
  const db = getDb();
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE portal_users SET password_hash = ? WHERE id = ?').run(hash, id);
}

// -- Session CRUD --

export function createSession(userId: number, stationDeviceId?: number): string {
  const db = getDb();
  const token = crypto.randomUUID();
  const now = nowISO();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, station_device_id) VALUES (?, ?, ?, ?, ?)').run(token, userId, now, expiresAt.toISOString(), stationDeviceId ?? null);
  db.prepare('UPDATE portal_users SET last_login = ?, login_count = login_count + 1 WHERE id = ?').run(now, userId);
  return token;
}

/** Delete all sessions created on a specific provisioned tablet (per-device revoke). */
export function deleteSessionsForDevice(stationDeviceId: number): void {
  getDb().prepare('DELETE FROM sessions WHERE station_device_id = ?').run(stationDeviceId);
}

/** Create a shared-tablet session, atomically replacing any prior session for the
 *  same device (one active session per device — also DB-enforced by a partial
 *  unique index on station_device_id). */
export function createTabletSession(userId: number, stationDeviceId: number): string {
  const db = getDb();
  const token = crypto.randomUUID();
  const now = nowISO();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE station_device_id = ?').run(stationDeviceId);
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, station_device_id) VALUES (?, ?, ?, ?, ?)')
      .run(token, userId, now, expiresAt.toISOString(), stationDeviceId);
  })();
  db.prepare('UPDATE portal_users SET last_login = ?, login_count = login_count + 1 WHERE id = ?').run(now, userId);
  return token;
}

export function getSessionUser(token: string): PortalUser | null {
  const db = getDb();
  const now = nowISO();
  // For a SHARED-TABLET session (station_device_id set) the session is only valid
  // while its device is still provisioned (not revoked) AND the station account is
  // still a staff-level shared-device account. So revoking a device, or changing
  // the station account's role/flag, invalidates its sessions on the very next
  // request — closing the revoke race and any privilege-escalation-by-edit. Normal
  // (NULL device) sessions are unaffected.
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.employee_id, u.applicant_id, u.must_change_password, u.status, u.active, u.login_count, u.tour_seen, u.allowed_company_ids, u.module_access, u.is_shared_device, u.preferences, u.created_at, u.last_login
    FROM sessions s
    JOIN portal_users u ON u.id = s.user_id
    LEFT JOIN station_devices d ON d.id = s.station_device_id
    WHERE s.token = ? AND u.active = 1 AND u.status = 'active' AND s.expires_at > ?
      AND (
        s.station_device_id IS NULL
        OR (d.id IS NOT NULL AND d.revoked = 0 AND u.role = 'staff' AND u.is_shared_device = 1)
      )
  `).get(token, now) as PortalUser | null;
  return row || null;
}

export function deleteSession(token: string) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanExpiredSessions() {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowISO());
}

// -- Station "who's acting" tokens (shared kitchen tablet) --

export interface StationActor {
  station_session: string;
  station_user_id: number;
  acting_user_id: number;
  acting_employee_id: number | null;
  company_id: number;
}

/** Mint a server-stored acting token after a PIN is verified. Returns the token
 *  to put in an httpOnly cookie — unforgeable and bound to the exact tablet login
 *  session (stationSession = the kw_session token). */
export function createStationActor(stationSession: string, stationUserId: number, actingUserId: number, actingEmployeeId: number | null, companyId: number, ttlMs: number): string {
  const db = getDb();
  cleanExpiredStationActors(); // opportunistic prune so the table can't grow unbounded
  const token = crypto.randomUUID();
  const now = nowISO();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  // Atomic replace: one acting person per tablet session. Purging any prior token
  // for this session in the same transaction means a failed sign-out can't leave a
  // stale actor valid when the next person PINs in.
  db.transaction(() => {
    db.prepare('DELETE FROM station_actors WHERE station_session = ?').run(stationSession);
    db.prepare(
      'INSERT INTO station_actors (token, station_session, station_user_id, acting_user_id, acting_employee_id, company_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(token, stationSession, stationUserId, actingUserId, actingEmployeeId ?? null, companyId, now, expiresAt);
  })();
  return token;
}

/** Resolve an acting token, or null if unknown/expired (expired rows are purged). */
export function getStationActor(token: string): StationActor | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT station_session, station_user_id, acting_user_id, acting_employee_id, company_id, expires_at FROM station_actors WHERE token = ?'
  ).get(token) as (StationActor & { expires_at: string }) | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM station_actors WHERE token = ?').run(token);
    return null;
  }
  return { station_session: row.station_session, station_user_id: row.station_user_id, acting_user_id: row.acting_user_id, acting_employee_id: row.acting_employee_id ?? null, company_id: row.company_id };
}

export function deleteStationActor(token: string) {
  getDb().prepare('DELETE FROM station_actors WHERE token = ?').run(token);
}

export function cleanExpiredStationActors() {
  getDb().prepare('DELETE FROM station_actors WHERE expires_at < ?').run(nowISO());
}

// -- Provisioned shared tablets (device credential for PIN-only login) --

function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

export interface StationDevice { id: number; station_user_id: number; company_id: number; label: string | null; locked_until: string | null; }

/** Provision a tablet: store the sha256 of a fresh device token, return the raw
 *  token to put in an httpOnly cookie. Bound to a restaurant's station account. */
export function provisionStationDevice(stationUserId: number, companyId: number, label: string | null, createdBy: string): string {
  const db = getDb();
  const token = randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO station_devices (token_hash, station_user_id, company_id, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sha256(token), stationUserId, companyId, label ?? null, createdBy, nowISO());
  return token;
}

/** Resolve a device token → its station account + company, or null if unknown/revoked. */
export function getStationDevice(token: string): StationDevice | null {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(
    'SELECT id, station_user_id, company_id, label, revoked, locked_until FROM station_devices WHERE token_hash = ?'
  ).get(sha256(token)) as (StationDevice & { revoked: number }) | undefined;
  if (!row || row.revoked) return null;
  db.prepare('UPDATE station_devices SET last_used_at = ? WHERE id = ?').run(nowISO(), row.id);
  return { id: row.id, station_user_id: row.station_user_id, company_id: row.company_id, label: row.label ?? null, locked_until: row.locked_until ?? null };
}

export function revokeStationDevice(token: string): void {
  if (!token) return;
  getDb().prepare('UPDATE station_devices SET revoked = 1 WHERE token_hash = ?').run(sha256(token));
}

/** Revoke ALL device tokens for a station account (full tablet reset for a restaurant). */
export function revokeStationDevicesForStation(stationUserId: number): void {
  getDb().prepare('UPDATE station_devices SET revoked = 1 WHERE station_user_id = ?').run(stationUserId);
}

// -- Persistent PIN brute-force lockout (survives restarts, unlike the in-memory limiter) --
const PIN_FAIL_THRESHOLD = 10;              // wrong PINs before a lockout
const PIN_LOCK_MS = 10 * 60 * 1000;         // lockout duration once tripped

/** Record a wrong PIN for a device; lock it for a while once the threshold trips. */
export function recordDeviceLoginFailure(deviceId: number): void {
  const db = getDb();
  const row = db.prepare('SELECT fail_count FROM station_devices WHERE id = ?').get(deviceId) as { fail_count: number } | undefined;
  const next = (row?.fail_count ?? 0) + 1;
  if (next >= PIN_FAIL_THRESHOLD) {
    db.prepare('UPDATE station_devices SET fail_count = 0, locked_until = ? WHERE id = ?')
      .run(new Date(Date.now() + PIN_LOCK_MS).toISOString(), deviceId);
  } else {
    db.prepare('UPDATE station_devices SET fail_count = ? WHERE id = ?').run(next, deviceId);
  }
}

/** Clear the failure counter + any lockout after a successful PIN. */
export function clearDeviceLoginFailures(deviceId: number): void {
  getDb().prepare('UPDATE station_devices SET fail_count = 0, locked_until = NULL WHERE id = ?').run(deviceId);
}

/** Delete all login sessions for a user (used to fully revoke tablet access). */
export function deleteSessionsForUser(userId: number): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** All active shared (is_shared_device) "station" accounts serving a given company.
 *  More than one is a misconfiguration the caller should reject (never guess). */
export function findStationAccountsForCompany(companyId: number): PortalUser[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, name, email, role, employee_id, applicant_id, must_change_password, status, active, login_count, tour_seen, allowed_company_ids, module_access, is_shared_device, (pin_hash IS NOT NULL) AS has_pin, created_at, last_login FROM portal_users WHERE is_shared_device = 1 AND active = 1 AND status = 'active' ORDER BY id"
  ).all() as PortalUser[];
  return rows.filter(u => parseCompanyIds(u.allowed_company_ids).includes(companyId));
}

// -- Registration Rate Limiting --

export function checkRegistrationRateLimit(identifier: string): { allowed: boolean; retryAfterMin: number } {
  const db = getDb();
  const thirtyMinAgo = new Date();
  thirtyMinAgo.setMinutes(thirtyMinAgo.getMinutes() - 30);
  const row = db.prepare(
    'SELECT COUNT(*) as c FROM registration_attempts WHERE ip_or_identifier = ? AND attempted_at > ?'
  ).get(identifier, thirtyMinAgo.toISOString()) as { c: number };
  if (row.c >= 5) {
    const oldest = db.prepare(
      'SELECT attempted_at FROM registration_attempts WHERE ip_or_identifier = ? AND attempted_at > ? ORDER BY attempted_at ASC LIMIT 1'
    ).get(identifier, thirtyMinAgo.toISOString()) as { attempted_at: string } | undefined;
    if (oldest) {
      const retryAt = new Date(oldest.attempted_at);
      retryAt.setMinutes(retryAt.getMinutes() + 30);
      const retryMin = Math.ceil((retryAt.getTime() - Date.now()) / 60000);
      return { allowed: false, retryAfterMin: Math.max(1, retryMin) };
    }
    return { allowed: false, retryAfterMin: 30 };
  }
  return { allowed: true, retryAfterMin: 0 };
}

export function recordRegistrationAttempt(identifier: string) {
  const db = getDb();
  db.prepare('INSERT INTO registration_attempts (ip_or_identifier, attempted_at) VALUES (?, ?)').run(identifier, nowISO());
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);
  db.prepare('DELETE FROM registration_attempts WHERE attempted_at < ?').run(oneHourAgo.toISOString());
}

// -- Password Reset Tokens --

const RESET_TOKEN_HOURS = 1;

export function createPasswordResetToken(userId: number): string {
  const db = getDb();
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?').run(nowISO());
  const token = crypto.randomUUID();
  const now = nowISO();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_HOURS);
  db.prepare('INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, now, expiresAt.toISOString());
  return token;
}

export function verifyPasswordResetToken(token: string): number | null {
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM password_reset_tokens WHERE token = ? AND expires_at > ?').get(token, nowISO()) as { user_id: number } | null;
  return row?.user_id || null;
}

export function deletePasswordResetToken(token: string) {
  const db = getDb();
  db.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token);
}

// -- Portal settings (global key/value) + per-company settings ------------------

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM portal_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO portal_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    )
    .run(key, value, new Date().toISOString());
}

/** One company's value for a key (companyId 0 = the shared default for all restaurants). */
export function getCompanySetting(companyId: number, key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM company_settings WHERE company_id=? AND key=?')
    .get(companyId, key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setCompanySetting(companyId: number, key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO company_settings (company_id, key, value, updated_at) VALUES (?,?,?,?) ON CONFLICT(company_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    )
    .run(companyId, key, value, new Date().toISOString());
}

/** All settings for a company as a key→value map. */
export function getCompanySettings(companyId: number): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT key, value FROM company_settings WHERE company_id=?')
    .all(companyId) as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// -- Feature permission overrides (per-action allowed roles) --------------------

/** All admin overrides as { action_key: string[] }. Missing action = registry default. */
export function getPermissionOverrides(): Record<string, string[]> {
  const rows = getDb()
    .prepare('SELECT action_key, allowed_roles FROM feature_permissions')
    .all() as { action_key: string; allowed_roles: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.allowed_roles);
      if (Array.isArray(arr)) out[r.action_key] = arr.filter((x): x is string => typeof x === 'string');
    } catch { /* skip corrupt row */ }
  }
  return out;
}

export function setPermissionOverride(actionKey: string, roles: string[]): void {
  getDb()
    .prepare(
      'INSERT INTO feature_permissions (action_key, allowed_roles, updated_at) VALUES (?,?,?) ' +
      'ON CONFLICT(action_key) DO UPDATE SET allowed_roles=excluded.allowed_roles, updated_at=excluded.updated_at',
    )
    .run(actionKey, JSON.stringify(roles), new Date().toISOString());
}

export function clearPermissionOverride(actionKey: string): void {
  getDb().prepare('DELETE FROM feature_permissions WHERE action_key = ?').run(actionKey);
}

/** Reset a set of actions to their registry defaults (used for per-module / global reset). */
export function clearPermissionOverrides(actionKeys: string[]): void {
  if (actionKeys.length === 0) return;
  const placeholders = actionKeys.map(() => '?').join(',');
  getDb().prepare(`DELETE FROM feature_permissions WHERE action_key IN (${placeholders})`).run(...actionKeys);
}

/** Resolve a per-company setting: this company → default company (0) → null. */
export function resolveCompanySetting(companyId: number | undefined, key: string): string | null {
  if (companyId && companyId > 0) {
    const v = getCompanySetting(companyId, key);
    if (v !== null && v !== '') return v;
  }
  const g = getCompanySetting(0, key);
  return g !== null && g !== '' ? g : null;
}

// -- Audit Log --

export function logAudit(data: {
  user_id?: number | null;
  user_name?: string | null;
  action: string;
  module: string;
  target_type?: string;
  target_id?: number;
  detail?: string;
}) {
  const db = getDb();
  db.prepare(
    'INSERT INTO audit_log (user_id, user_name, action, module, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    data.user_id ?? null,
    data.user_name ?? null,
    data.action,
    data.module,
    data.target_type ?? null,
    data.target_id ?? null,
    data.detail ?? null,
    nowISO(),
  );
}

export function getAuditLog(filters?: { module?: string; limit?: number }): any[] {
  const db = getDb();
  const where: string[] = [];
  const vals: any[] = [];
  if (filters?.module) { where.push('module = ?'); vals.push(filters.module); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = filters?.limit || 100;
  vals.push(limit);
  return db.prepare(`SELECT * FROM audit_log ${clause} ORDER BY created_at DESC LIMIT ?`).all(...vals);
}

// -- Staff Invites --

export interface StaffInvite {
  id: number;
  employee_id: number;
  name: string;
  email: string | null;
  token_hash: string;
  status: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  created_by: string | null;
}

export function createInvite(d: { employee_id: number; name: string; email: string | null; token_hash: string; expires_at: string; created_by: string }): number {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO portal_invites (employee_id, name, email, token_hash, status, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(d.employee_id, d.name, d.email, d.token_hash, 'pending', nowISO(), d.expires_at, d.created_by);
  return result.lastInsertRowid as number;
}

export function getInviteByTokenHash(tokenHash: string): StaffInvite | null {
  const db = getDb();
  return db.prepare('SELECT * FROM portal_invites WHERE token_hash = ?').get(tokenHash) as StaffInvite | null;
}

export function getActiveInviteByEmployeeId(employeeId: number): StaffInvite | null {
  const db = getDb();
  return db.prepare("SELECT * FROM portal_invites WHERE employee_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1").get(employeeId, nowISO()) as StaffInvite | null;
}

export function revokeInvitesForEmployee(employeeId: number): void {
  const db = getDb();
  db.prepare("UPDATE portal_invites SET status = 'revoked' WHERE employee_id = ? AND status = 'pending'").run(employeeId);
}

export function markInviteAccepted(id: number): void {
  const db = getDb();
  db.prepare("UPDATE portal_invites SET status = 'accepted', accepted_at = ? WHERE id = ?").run(nowISO(), id);
}

export function listPendingInvites(): StaffInvite[] {
  const db = getDb();
  return db.prepare("SELECT * FROM portal_invites WHERE status = 'pending' AND expires_at > ? ORDER BY created_at DESC").all(nowISO()) as StaffInvite[];
}

export function listEmployeeIdsWithAccounts(): number[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT employee_id FROM portal_users WHERE employee_id IS NOT NULL AND active = 1').all() as { employee_id: number }[];
  return rows.map(r => r.employee_id);
}

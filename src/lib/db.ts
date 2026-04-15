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
      expires_at TEXT NOT NULL
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

    CREATE INDEX IF NOT EXISTS idx_users_email ON portal_users(email);
    CREATE INDEX IF NOT EXISTS idx_users_employee ON portal_users(employee_id);
    CREATE INDEX IF NOT EXISTS idx_users_status ON portal_users(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_reg_attempts ON registration_attempts(ip_or_identifier, attempted_at);

    CREATE TABLE IF NOT EXISTS portal_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
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

export function getUserById(id: number): PortalUser | null {
  const db = getDb();
  return db.prepare('SELECT id, name, email, role, employee_id, applicant_id, must_change_password, status, active, login_count, tour_seen, allowed_company_ids, created_at, last_login FROM portal_users WHERE id = ?').get(id) as PortalUser | null;
}

export function listUsers(): PortalUser[] {
  const db = getDb();
  return db.prepare('SELECT id, name, email, role, employee_id, applicant_id, must_change_password, status, active, login_count, tour_seen, allowed_company_ids, created_at, last_login FROM portal_users ORDER BY created_at DESC').all() as PortalUser[];
}

export function listUsersByStatus(status: string): PortalUser[] {
  const db = getDb();
  return db.prepare('SELECT id, name, email, role, employee_id, applicant_id, must_change_password, status, active, login_count, tour_seen, allowed_company_ids, created_at, last_login FROM portal_users WHERE status = ? AND active = 1 ORDER BY created_at DESC').all(status) as PortalUser[];
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

export function updateUser(id: number, updates: { name?: string; role?: string; active?: number; employee_id?: number | null; applicant_id?: number | null; must_change_password?: number; status?: string; allowed_company_ids?: number[] }) {
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
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE portal_users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
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

export function createSession(userId: number): string {
  const db = getDb();
  const token = crypto.randomUUID();
  const now = nowISO();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, now, expiresAt.toISOString());
  db.prepare('UPDATE portal_users SET last_login = ?, login_count = login_count + 1 WHERE id = ?').run(now, userId);
  return token;
}

export function getSessionUser(token: string): PortalUser | null {
  const db = getDb();
  const now = nowISO();
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.employee_id, u.applicant_id, u.must_change_password, u.status, u.active, u.login_count, u.tour_seen, u.allowed_company_ids, u.created_at, u.last_login
    FROM sessions s
    JOIN portal_users u ON u.id = s.user_id
    WHERE s.token = ? AND u.active = 1 AND u.status = 'active' AND s.expires_at > ?
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

/**
 * Portal SQLite database — stores users and sessions.
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

export function getDb(): Database.Database {
  if (!_db) {
    // Ensure data directory exists
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initTables(_db);
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
      role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('staff', 'manager', 'admin')),
      employee_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON portal_users(email);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
}

/**
 * Auto-create an admin user if the DB is empty.
 * Default password: krawings2026 (change immediately!)
 */
function seedAdmin(db: Database.Database) {
  const row = db.prepare('SELECT COUNT(*) as c FROM portal_users').get() as { c: number };
  if (row.c === 0) {
    const email = process.env.ODOO_USER || 'admin@krawings.de';
    const hash = bcrypt.hashSync('krawings2026', 10);
    db.prepare(
      'INSERT INTO portal_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run('Admin', email, hash, 'admin');
    console.log(`Portal: created initial admin user (${email}). Change the password!`);
  }
}

// ── User CRUD ──

export interface PortalUser {
  id: number;
  name: string;
  email: string;
  role: 'staff' | 'manager' | 'admin';
  employee_id: number | null;
  active: number;
  created_at: string;
  last_login: string | null;
}

export function getUserByEmail(email: string): PortalUser & { password_hash: string } | null {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM portal_users WHERE email = ? AND active = 1'
  ).get(email) as (PortalUser & { password_hash: string }) | null;
}

export function getUserById(id: number): PortalUser | null {
  const db = getDb();
  return db.prepare(
    'SELECT id, name, email, role, employee_id, active, created_at, last_login FROM portal_users WHERE id = ?'
  ).get(id) as PortalUser | null;
}

export function listUsers(): PortalUser[] {
  const db = getDb();
  return db.prepare(
    'SELECT id, name, email, role, employee_id, active, created_at, last_login FROM portal_users ORDER BY created_at DESC'
  ).all() as PortalUser[];
}

export function createUser(name: string, email: string, password: string, role: string): number {
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO portal_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(name, email.toLowerCase().trim(), hash, role);
  return result.lastInsertRowid as number;
}

export function updateUser(id: number, updates: { name?: string; role?: string; active?: number; employee_id?: number | null }) {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.role !== undefined) { sets.push('role = ?'); vals.push(updates.role); }
  if (updates.active !== undefined) { sets.push('active = ?'); vals.push(updates.active); }
  if (updates.employee_id !== undefined) { sets.push('employee_id = ?'); vals.push(updates.employee_id); }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE portal_users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function resetPassword(id: number, newPassword: string) {
  const db = getDb();
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE portal_users SET password_hash = ? WHERE id = ?').run(hash, id);
}

// ── Session CRUD ──

const SESSION_DAYS = 30;

export function createSession(userId: number): string {
  const db = getDb();
  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(token, userId, expiresAt.toISOString());
  db.prepare('UPDATE portal_users SET last_login = datetime("now") WHERE id = ?').run(userId);
  return token;
}

export function getSessionUser(token: string): PortalUser | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.employee_id, u.active, u.created_at, u.last_login
    FROM sessions s
    JOIN portal_users u ON u.id = s.user_id
    WHERE s.token = ? AND u.active = 1 AND s.expires_at > datetime('now')
  `).get(token) as PortalUser | null;
  if (!row) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

export function deleteSession(token: string) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanExpiredSessions() {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

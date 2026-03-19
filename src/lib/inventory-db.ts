/**
 * Inventory Module — SQLite Schema & CRUD
 *
 * Counting templates, sessions, and entries live here.
 * Odoo remains source of truth for products, locations, and stock.quant.
 * On approval, the API route writes inventory_quantity to Odoo.
 */
import { getDb } from './db';
import type {
  CountingTemplate, CountingSession, CountEntry, QuickCount,
  Frequency, AssignType, SessionStatus,
} from '@/types/inventory';

// ═══════════════════════════════════════════
// SCHEMA INIT
// ═══════════════════════════════════════════

export function initInventoryTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS counting_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'adhoc',
      location_id INTEGER NOT NULL,
      category_ids TEXT NOT NULL DEFAULT '[]',
      product_ids TEXT NOT NULL DEFAULT '[]',
      assign_type TEXT,
      assign_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counting_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES counting_templates(id),
      scheduled_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      location_id INTEGER NOT NULL,
      assigned_user_id INTEGER,
      submitted_at TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS count_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES counting_sessions(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      counted_qty REAL NOT NULL,
      system_qty REAL,
      diff REAL,
      uom TEXT NOT NULL DEFAULT 'Units',
      notes TEXT,
      counted_by INTEGER NOT NULL,
      counted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quick_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      counted_qty REAL NOT NULL,
      uom TEXT NOT NULL DEFAULT 'Units',
      counted_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL,
      reviewed_by INTEGER,
      reviewed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_template ON counting_sessions(template_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON counting_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_entries_session ON count_entries(session_id);
    CREATE INDEX IF NOT EXISTS idx_quick_status ON quick_counts(status);
  `);
}

function now(): string {
  return new Date().toISOString();
}

// ═══════════════════════════════════════════
// TEMPLATES CRUD
// ═══════════════════════════════════════════

export function createTemplate(data: {
  name: string;
  frequency: Frequency;
  location_id: number;
  category_ids: number[];
  product_ids?: number[];
  assign_type: AssignType;
  assign_id: number | null;
  created_by: number;
}): number {
  const db = getDb();
  const ts = now();
  const r = db.prepare(`
    INSERT INTO counting_templates (name, frequency, location_id, category_ids, product_ids, assign_type, assign_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.name, data.frequency, data.location_id,
    JSON.stringify(data.category_ids), JSON.stringify(data.product_ids || []),
    data.assign_type, data.assign_id, data.created_by, ts, ts
  );
  return r.lastInsertRowid as number;
}

export function updateTemplate(id: number, data: Partial<{
  name: string;
  frequency: Frequency;
  location_id: number;
  category_ids: number[];
  product_ids: number[];
  assign_type: AssignType;
  assign_id: number | null;
  active: boolean;
}>) {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.frequency !== undefined) { sets.push('frequency = ?'); vals.push(data.frequency); }
  if (data.location_id !== undefined) { sets.push('location_id = ?'); vals.push(data.location_id); }
  if (data.category_ids !== undefined) { sets.push('category_ids = ?'); vals.push(JSON.stringify(data.category_ids)); }
  if (data.product_ids !== undefined) { sets.push('product_ids = ?'); vals.push(JSON.stringify(data.product_ids)); }
  if (data.assign_type !== undefined) { sets.push('assign_type = ?'); vals.push(data.assign_type); }
  if (data.assign_id !== undefined) { sets.push('assign_id = ?'); vals.push(data.assign_id); }
  if (data.active !== undefined) { sets.push('active = ?'); vals.push(data.active ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?'); vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE counting_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getTemplate(id: number): CountingTemplate | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM counting_templates WHERE id = ?').get(id) as any;
  return row ? parseTemplate(row) : null;
}

export function listTemplates(filters?: { location_id?: number; active?: boolean }): CountingTemplate[] {
  const db = getDb();
  const where: string[] = [];
  const vals: any[] = [];
  if (filters?.location_id) { where.push('location_id = ?'); vals.push(filters.location_id); }
  if (filters?.active !== undefined) { where.push('active = ?'); vals.push(filters.active ? 1 : 0); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM counting_templates ${clause} ORDER BY updated_at DESC`).all(...vals) as any[];
  return rows.map(parseTemplate);
}

function parseTemplate(row: any): CountingTemplate {
  return {
    ...row,
    category_ids: JSON.parse(row.category_ids || '[]'),
    product_ids: JSON.parse(row.product_ids || '[]'),
    active: !!row.active,
  };
}

// ═══════════════════════════════════════════
// SESSIONS CRUD
// ═══════════════════════════════════════════

export function createSession(data: {
  template_id: number;
  scheduled_date: string;
  location_id: number;
  assigned_user_id?: number | null;
}): number {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO counting_sessions (template_id, scheduled_date, location_id, assigned_user_id, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(data.template_id, data.scheduled_date, data.location_id, data.assigned_user_id || null, now());
  return r.lastInsertRowid as number;
}

export function listSessions(filters?: {
  status?: SessionStatus;
  template_id?: number;
  location_id?: number;
  assigned_user_id?: number;
}): CountingSession[] {
  const db = getDb();
  const where: string[] = [];
  const vals: any[] = [];
  if (filters?.status) { where.push('s.status = ?'); vals.push(filters.status); }
  if (filters?.template_id) { where.push('s.template_id = ?'); vals.push(filters.template_id); }
  if (filters?.location_id) { where.push('s.location_id = ?'); vals.push(filters.location_id); }
  if (filters?.assigned_user_id) { where.push('s.assigned_user_id = ?'); vals.push(filters.assigned_user_id); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`
    SELECT s.*, t.name as template_name
    FROM counting_sessions s
    LEFT JOIN counting_templates t ON t.id = s.template_id
    ${clause}
    ORDER BY s.scheduled_date DESC
  `).all(...vals) as CountingSession[];
}

export function getSession(id: number): CountingSession | null {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, t.name as template_name
    FROM counting_sessions s
    LEFT JOIN counting_templates t ON t.id = s.template_id
    WHERE s.id = ?
  `).get(id) as CountingSession | null;
}

export function updateSessionStatus(id: number, status: SessionStatus, extra?: {
  reviewed_by?: number;
  review_note?: string;
}) {
  const db = getDb();
  const ts = now();
  if (status === 'submitted') {
    db.prepare('UPDATE counting_sessions SET status = ?, submitted_at = ? WHERE id = ?').run(status, ts, id);
  } else if (status === 'approved' || status === 'rejected') {
    db.prepare('UPDATE counting_sessions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?')
      .run(status, extra?.reviewed_by || null, ts, extra?.review_note || null, id);
  } else {
    db.prepare('UPDATE counting_sessions SET status = ? WHERE id = ?').run(status, id);
  }
}

// ═══════════════════════════════════════════
// COUNT ENTRIES
// ═══════════════════════════════════════════

export function upsertCountEntry(data: {
  session_id: number;
  product_id: number;
  counted_qty: number;
  system_qty?: number | null;
  uom: string;
  notes?: string;
  counted_by: number;
}) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM count_entries WHERE session_id = ? AND product_id = ?'
  ).get(data.session_id, data.product_id) as { id: number } | undefined;

  const diff = data.system_qty != null ? data.counted_qty - data.system_qty : null;

  if (existing) {
    db.prepare(`
      UPDATE count_entries SET counted_qty = ?, system_qty = ?, diff = ?, uom = ?, notes = ?, counted_at = ?
      WHERE id = ?
    `).run(data.counted_qty, data.system_qty ?? null, diff, data.uom, data.notes || null, now(), existing.id);
  } else {
    db.prepare(`
      INSERT INTO count_entries (session_id, product_id, counted_qty, system_qty, diff, uom, notes, counted_by, counted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.session_id, data.product_id, data.counted_qty, data.system_qty ?? null, diff, data.uom, data.notes || null, data.counted_by, now());
  }
}

export function deleteCountEntry(session_id: number, product_id: number) {
  const db = getDb();
  db.prepare('DELETE FROM count_entries WHERE session_id = ? AND product_id = ?').run(session_id, product_id);
}

export function getSessionEntries(session_id: number): CountEntry[] {
  const db = getDb();
  return db.prepare('SELECT * FROM count_entries WHERE session_id = ? ORDER BY counted_at DESC').all(session_id) as CountEntry[];
}

// ═══════════════════════════════════════════
// QUICK COUNTS
// ═══════════════════════════════════════════

export function createQuickCount(data: {
  product_id: number;
  location_id: number;
  counted_qty: number;
  uom: string;
  counted_by: number;
}): number {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO quick_counts (product_id, location_id, counted_qty, uom, counted_by, status, submitted_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(data.product_id, data.location_id, data.counted_qty, data.uom, data.counted_by, now());
  return r.lastInsertRowid as number;
}

export function listQuickCounts(filters?: { status?: string; counted_by?: number }): QuickCount[] {
  const db = getDb();
  const where: string[] = [];
  const vals: any[] = [];
  if (filters?.status) { where.push('status = ?'); vals.push(filters.status); }
  if (filters?.counted_by) { where.push('counted_by = ?'); vals.push(filters.counted_by); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`SELECT * FROM quick_counts ${clause} ORDER BY submitted_at DESC`).all(...vals) as QuickCount[];
}

export function approveQuickCount(id: number, reviewed_by: number) {
  const db = getDb();
  db.prepare('UPDATE quick_counts SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
    .run('approved', reviewed_by, now(), id);
}

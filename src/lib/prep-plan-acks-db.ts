/**
 * Cook-facing prep plan acknowledgments.
 * One row per (user, shift_date, prep_item) — upsert on conflict.
 */
import { getDb } from './db';

function nowISO(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T');
}

let _initialized = false;

function ensureTables() {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS prep_plan_acks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      shift_date TEXT NOT NULL,
      prep_item_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('confirm','adjust','skip')),
      planned_qty REAL,
      forecast_qty REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, shift_date, prep_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prep_plan_acks_co_date
      ON prep_plan_acks(company_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_prep_plan_acks_user_date
      ON prep_plan_acks(user_id, shift_date);
  `);
  _initialized = true;
}

export interface PrepPlanAck {
  id: number;
  company_id: number;
  user_id: number;
  shift_date: string;
  prep_item_id: number;
  action: 'confirm' | 'adjust' | 'skip';
  planned_qty: number | null;
  forecast_qty: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertAckInput {
  company_id: number;
  user_id: number;
  shift_date: string;
  prep_item_id: number;
  action: 'confirm' | 'adjust' | 'skip';
  planned_qty: number | null;
  forecast_qty: number;
}

export function upsertAck(input: UpsertAckInput): PrepPlanAck {
  ensureTables();
  const db = getDb();
  const now = nowISO();
  db.prepare(`
    INSERT INTO prep_plan_acks
      (company_id, user_id, shift_date, prep_item_id, action, planned_qty, forecast_qty, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, shift_date, prep_item_id) DO UPDATE SET
      action=excluded.action,
      planned_qty=excluded.planned_qty,
      forecast_qty=excluded.forecast_qty,
      updated_at=excluded.updated_at
  `).run(
    input.company_id,
    input.user_id,
    input.shift_date,
    input.prep_item_id,
    input.action,
    input.planned_qty,
    input.forecast_qty,
    now,
    now,
  );
  const row = db.prepare(
    'SELECT * FROM prep_plan_acks WHERE user_id = ? AND shift_date = ? AND prep_item_id = ?',
  ).get(input.user_id, input.shift_date, input.prep_item_id) as PrepPlanAck;
  return row;
}

export function listAcksForUser(userId: number, shiftDate: string): PrepPlanAck[] {
  ensureTables();
  const db = getDb();
  return db.prepare(
    'SELECT * FROM prep_plan_acks WHERE user_id = ? AND shift_date = ?',
  ).all(userId, shiftDate) as PrepPlanAck[];
}

export function listAcksForCompanyDate(companyId: number, shiftDate: string): PrepPlanAck[] {
  ensureTables();
  const db = getDb();
  return db.prepare(
    'SELECT * FROM prep_plan_acks WHERE company_id = ? AND shift_date = ? ORDER BY updated_at DESC',
  ).all(companyId, shiftDate) as PrepPlanAck[];
}

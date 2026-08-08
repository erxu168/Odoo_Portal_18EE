// Closing Report — persistence.
//
// One short questionnaire per department per night. The template lives in
// closing_questions; a submitted report SNAPSHOTS its questions into
// closing_answers, so editing the template later never rewrites history.
// The one-report-per-night rule is a UNIQUE constraint, so two devices racing
// to submit resolve in the database, not in application code.
import { getDb } from '@/lib/db';
import type { AnswerRow, QType, QuestionDef } from './validate';

let _inited = false;

export function initClosingTables(): void {
  const db = getDb();
  if (_inited) return;
  try { db.pragma('busy_timeout = 5000'); } catch { /* best effort */ }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS closing_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        department_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL,
        qtype TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        problem_values_json TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_closing_questions_dept
        ON closing_questions (company_id, department_id, active);

      CREATE TABLE IF NOT EXISTS closing_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        department_id INTEGER NOT NULL,
        report_date TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        submitted_by_user_id INTEGER,
        submitted_by_name TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        UNIQUE (company_id, department_id, report_date)
      );
      CREATE INDEX IF NOT EXISTS idx_closing_reports_date
        ON closing_reports (company_id, report_date);

      CREATE TABLE IF NOT EXISTS closing_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        question_id INTEGER,
        position INTEGER NOT NULL DEFAULT 0,
        question_text TEXT NOT NULL,
        qtype TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        problem_values_json TEXT NOT NULL DEFAULT '[]',
        value TEXT NOT NULL DEFAULT '',
        is_problem INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        task_line_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_closing_answers_report
        ON closing_answers (report_id);

      CREATE TABLE IF NOT EXISTS closing_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        answer_id INTEGER NOT NULL,
        photo TEXT NOT NULL,
        uploaded_by_user_id INTEGER,
        uploaded_by_name TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_closing_photos_answer
        ON closing_photos (answer_id);

      CREATE TABLE IF NOT EXISTS closing_settings (
        company_id INTEGER PRIMARY KEY,
        missing_email_enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS closing_email_log (
        company_id INTEGER NOT NULL,
        report_date TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (company_id, report_date)
      );
    `);
  } catch (e) {
    console.error('[closing-report] table init error:', e);
  }
  _inited = true;
}

const nowISO = () => new Date().toISOString();

function parseList(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Questions (the template)
// ---------------------------------------------------------------------------

export interface ClosingQuestion extends QuestionDef {
  company_id: number;
  department_id: number;
  active: boolean;
}

interface QuestionRowRaw {
  id: number; company_id: number; department_id: number; position: number;
  text: string; qtype: QType; options_json: string; problem_values_json: string; active: number;
}

function questionFromRow(r: QuestionRowRaw): ClosingQuestion {
  return {
    id: r.id, company_id: r.company_id, department_id: r.department_id,
    position: r.position, text: r.text, qtype: r.qtype,
    options: parseList(r.options_json),
    problem_values: parseList(r.problem_values_json),
    active: !!r.active,
  };
}

export function listQuestions(companyId: number, departmentId: number, opts?: { activeOnly?: boolean }): ClosingQuestion[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM closing_questions
    WHERE company_id = ? AND department_id = ? ${opts?.activeOnly === false ? '' : 'AND active = 1'}
    ORDER BY position, id
  `).all(companyId, departmentId) as QuestionRowRaw[];
  return rows.map(questionFromRow);
}

export function getQuestion(id: number): ClosingQuestion | null {
  const r = getDb().prepare('SELECT * FROM closing_questions WHERE id = ?').get(id) as QuestionRowRaw | undefined;
  return r ? questionFromRow(r) : null;
}

export function countQuestions(companyId: number, departmentId: number): number {
  const r = getDb().prepare(
    'SELECT COUNT(*) AS n FROM closing_questions WHERE company_id = ? AND department_id = ?',
  ).get(companyId, departmentId) as { n: number };
  return r.n;
}

export function createQuestion(
  companyId: number, departmentId: number,
  v: { text: string; qtype: QType; options: string[]; problem_values: string[] },
): number {
  const db = getDb();
  const pos = (db.prepare(
    'SELECT COALESCE(MAX(position), 0) AS p FROM closing_questions WHERE company_id = ? AND department_id = ?',
  ).get(companyId, departmentId) as { p: number }).p + 1;
  const t = nowISO();
  const res = db.prepare(`
    INSERT INTO closing_questions (company_id, department_id, position, text, qtype, options_json, problem_values_json, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(companyId, departmentId, pos, v.text, v.qtype, JSON.stringify(v.options), JSON.stringify(v.problem_values), t, t);
  return Number(res.lastInsertRowid);
}

export function updateQuestion(
  id: number,
  v: { text: string; qtype: QType; options: string[]; problem_values: string[] },
): void {
  getDb().prepare(`
    UPDATE closing_questions
    SET text = ?, qtype = ?, options_json = ?, problem_values_json = ?, updated_at = ?
    WHERE id = ?
  `).run(v.text, v.qtype, JSON.stringify(v.options), JSON.stringify(v.problem_values), nowISO(), id);
}

/** Hard delete — submitted reports carry their own snapshot, so history survives. */
export function deleteQuestion(id: number): void {
  getDb().prepare('DELETE FROM closing_questions WHERE id = ?').run(id);
}

export function reorderQuestions(companyId: number, departmentId: number, orderedIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare(
    'UPDATE closing_questions SET position = ?, updated_at = ? WHERE id = ? AND company_id = ? AND department_id = ?',
  );
  const t = nowISO();
  db.transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i + 1, t, id, companyId, departmentId));
  })();
}

/** Departments that take part = departments with at least one active question. */
export function departmentIdsWithQuestions(companyId: number): number[] {
  const rows = getDb().prepare(
    'SELECT DISTINCT department_id FROM closing_questions WHERE company_id = ? AND active = 1',
  ).all(companyId) as { department_id: number }[];
  return rows.map((r) => r.department_id);
}

/** The starter set a manager can load into an empty department with one tap. */
export const STARTER_QUESTIONS: { text: string; qtype: QType; options: string[]; problem_values: string[] }[] = [
  { text: 'Is all equipment working?', qtype: 'yes_no', options: [], problem_values: ['no'] },
  { text: 'Is everything clean and ready for the morning team?', qtype: 'yes_no', options: [], problem_values: ['no'] },
  { text: 'Did we run out of anything tonight?', qtype: 'yes_no', options: [], problem_values: ['yes'] },
  { text: 'How busy was tonight?', qtype: 'choice', options: ['Quiet', 'Normal', 'Busy', 'Slammed'], problem_values: [] },
  { text: 'How did the team run tonight?', qtype: 'rating', options: [], problem_values: [] },
  { text: 'Anything the morning team should know?', qtype: 'text', options: [], problem_values: [] },
];

/** Load the starter set — only into a department that has never had a question. */
export function seedStarterQuestions(companyId: number, departmentId: number): boolean {
  if (countQuestions(companyId, departmentId) > 0) return false;
  const db = getDb();
  db.transaction(() => {
    for (const q of STARTER_QUESTIONS) createQuestion(companyId, departmentId, q);
  })();
  return true;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export const MAX_PHOTOS_PER_ANSWER = 3;
export const MAX_PHOTOS_PER_REPORT = 10;
export const MAX_PHOTO_TOTAL_CHARS = 12_000_000; // aggregate cap per report (~8.5 MB binary)
const MAX_PHOTO_CHARS = 3_500_000; // ~2.5 MB binary as base64

export function filterValidPhotos(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((p): p is string => typeof p === 'string' && p.startsWith('data:image/') && p.length <= MAX_PHOTO_CHARS)
    .slice(0, MAX_PHOTOS_PER_ANSWER);
}

/** Photos for a whole submission, with REPORT-wide count and byte caps on top
 *  of the per-answer cap — a single report can't balloon the database. */
export function collectReportPhotos(entries: { question_id: number; photos?: unknown }[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  let count = 0;
  let chars = 0;
  for (const e of entries) {
    for (const p of filterValidPhotos(e.photos)) {
      if (count >= MAX_PHOTOS_PER_REPORT || chars + p.length > MAX_PHOTO_TOTAL_CHARS) return out;
      if (!out[e.question_id]) out[e.question_id] = [];
      out[e.question_id].push(p);
      count += 1;
      chars += p.length;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ClosingAnswer {
  id: number;
  question_id: number | null;
  position: number;
  question_text: string;
  qtype: QType;
  options: string[];
  problem_values: string[];
  value: string;
  is_problem: boolean;
  note: string | null;
  task_line_id: number | null;
  photos: string[];
}

export interface ClosingReport {
  id: number;
  company_id: number;
  department_id: number;
  report_date: string;
  submitted_at: string;
  submitted_by_user_id: number | null;
  submitted_by_name: string;
  updated_at: string;
  answers: ClosingAnswer[];
}

interface ReportRowRaw {
  id: number; company_id: number; department_id: number; report_date: string;
  submitted_at: string; submitted_by_user_id: number | null; submitted_by_name: string; updated_at: string;
}

interface AnswerRowRaw {
  id: number; report_id: number; question_id: number | null; position: number;
  question_text: string; qtype: QType; options_json: string; problem_values_json: string; value: string;
  is_problem: number; note: string | null; task_line_id: number | null;
}

function attachAnswers(reports: ReportRowRaw[]): ClosingReport[] {
  if (reports.length === 0) return [];
  const db = getDb();
  const ids = reports.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const answers = db.prepare(
    `SELECT * FROM closing_answers WHERE report_id IN (${marks}) ORDER BY position, id`,
  ).all(...ids) as AnswerRowRaw[];
  const answerIds = answers.map((a) => a.id);
  const photosByAnswer = new Map<number, string[]>();
  if (answerIds.length > 0) {
    const pmarks = answerIds.map(() => '?').join(',');
    const photos = db.prepare(
      `SELECT answer_id, photo FROM closing_photos WHERE answer_id IN (${pmarks}) ORDER BY id`,
    ).all(...answerIds) as { answer_id: number; photo: string }[];
    for (const p of photos) {
      const list = photosByAnswer.get(p.answer_id) || [];
      list.push(p.photo);
      photosByAnswer.set(p.answer_id, list);
    }
  }
  const byReport = new Map<number, ClosingAnswer[]>();
  for (const a of answers) {
    const list = byReport.get(a.report_id) || [];
    list.push({
      id: a.id, question_id: a.question_id, position: a.position,
      question_text: a.question_text, qtype: a.qtype, options: parseList(a.options_json),
      problem_values: parseList(a.problem_values_json),
      value: a.value, is_problem: !!a.is_problem, note: a.note,
      task_line_id: a.task_line_id, photos: photosByAnswer.get(a.id) || [],
    });
    byReport.set(a.report_id, list);
  }
  return reports.map((r) => ({ ...r, answers: byReport.get(r.id) || [] }));
}

export function getReport(companyId: number, departmentId: number, reportDate: string): ClosingReport | null {
  const r = getDb().prepare(
    'SELECT * FROM closing_reports WHERE company_id = ? AND department_id = ? AND report_date = ?',
  ).get(companyId, departmentId, reportDate) as ReportRowRaw | undefined;
  return r ? attachAnswers([r])[0] : null;
}

export function getReportById(id: number): ClosingReport | null {
  const r = getDb().prepare('SELECT * FROM closing_reports WHERE id = ?').get(id) as ReportRowRaw | undefined;
  return r ? attachAnswers([r])[0] : null;
}

export function listReportsForDate(companyId: number, reportDate: string): ClosingReport[] {
  const rows = getDb().prepare(
    'SELECT * FROM closing_reports WHERE company_id = ? AND report_date = ? ORDER BY department_id',
  ).all(companyId, reportDate) as ReportRowRaw[];
  return attachAnswers(rows);
}

export class ReportExistsError extends Error {
  constructor() { super('A report for this department and night already exists.'); }
}

function insertAnswers(
  reportId: number, companyId: number, rows: AnswerRow[],
  photosByQuestionId: Record<number, string[]>,
  uploader: { userId: number | null; name: string },
  preservedTaskLines?: Map<number, number>,
): void {
  const db = getDb();
  const insAnswer = db.prepare(`
    INSERT INTO closing_answers (report_id, question_id, position, question_text, qtype, options_json, problem_values_json, value, is_problem, note, task_line_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insPhoto = db.prepare(`
    INSERT INTO closing_photos (company_id, answer_id, photo, uploaded_by_user_id, uploaded_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const t = nowISO();
  for (const row of rows) {
    const taskLine = preservedTaskLines?.get(row.question_id) ?? null;
    const res = insAnswer.run(
      reportId, row.question_id, row.position, row.question_text, row.qtype,
      JSON.stringify(row.options), JSON.stringify(row.problem_values),
      row.value, row.is_problem ? 1 : 0, row.note, taskLine,
    );
    if (row.is_problem) {
      const answerId = Number(res.lastInsertRowid);
      for (const photo of filterValidPhotos(photosByQuestionId[row.question_id])) {
        insPhoto.run(companyId, answerId, photo, uploader.userId, uploader.name, t);
      }
    }
  }
}

export function createReport(
  meta: { company_id: number; department_id: number; report_date: string; submitted_by_user_id: number | null; submitted_by_name: string },
  rows: AnswerRow[],
  photosByQuestionId: Record<number, string[]>,
): number {
  const db = getDb();
  const t = nowISO();
  try {
    let reportId = 0;
    db.transaction(() => {
      const res = db.prepare(`
        INSERT INTO closing_reports (company_id, department_id, report_date, submitted_at, submitted_by_user_id, submitted_by_name, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(meta.company_id, meta.department_id, meta.report_date, t, meta.submitted_by_user_id, meta.submitted_by_name, t);
      reportId = Number(res.lastInsertRowid);
      insertAnswers(reportId, meta.company_id, rows, photosByQuestionId,
        { userId: meta.submitted_by_user_id, name: meta.submitted_by_name });
    })();
    return reportId;
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) throw new ReportExistsError();
    throw e;
  }
}

/** Replace a report's answers (a correction before the 05:00 lock). Keeps any
 *  follow-up task links by question, so a manager's created task stays linked. */
export function updateReportAnswers(
  report: ClosingReport,
  rows: AnswerRow[],
  photosByQuestionId: Record<number, string[]>,
  uploader: { userId: number | null; name: string },
): void {
  const db = getDb();
  const preserved = new Map<number, number>();
  for (const a of report.answers) {
    // Only real Odoo line ids survive a correction — a pending (negative) claim
    // must not, or the claimer's final id-update would target a deleted row.
    if (a.question_id != null && a.task_line_id != null && a.task_line_id > 0) {
      preserved.set(a.question_id, a.task_line_id);
    }
  }
  db.transaction(() => {
    const answerIds = report.answers.map((a) => a.id);
    if (answerIds.length > 0) {
      const marks = answerIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM closing_photos WHERE answer_id IN (${marks})`).run(...answerIds);
    }
    db.prepare('DELETE FROM closing_answers WHERE report_id = ?').run(report.id);
    insertAnswers(report.id, report.company_id, rows, photosByQuestionId, uploader, preserved);
    db.prepare('UPDATE closing_reports SET updated_at = ? WHERE id = ?').run(nowISO(), report.id);
  })();
}

/** Manager-only removal of a bogus report (frees the night for a resubmit). */
export function deleteReport(reportId: number): void {
  const db = getDb();
  db.transaction(() => {
    const answerIds = (db.prepare('SELECT id FROM closing_answers WHERE report_id = ?').all(reportId) as { id: number }[]).map((r) => r.id);
    if (answerIds.length > 0) {
      const marks = answerIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM closing_photos WHERE answer_id IN (${marks})`).run(...answerIds);
    }
    db.prepare('DELETE FROM closing_answers WHERE report_id = ?').run(reportId);
    db.prepare('DELETE FROM closing_reports WHERE id = ?').run(reportId);
  })();
}

export function setAnswerTaskLine(answerId: number, taskLineId: number | null): void {
  getDb().prepare('UPDATE closing_answers SET task_line_id = ? WHERE id = ?').run(taskLineId, answerId);
}

// A pending claim is stored as a NEGATIVE epoch-seconds token (a real Odoo line
// id is positive), so a crash mid-create leaves an inspectable, age-checkable
// claim instead of a permanently stuck flag.
export function claimToken(): number {
  return -Math.floor(Date.now() / 1000);
}

export function claimAgeSeconds(storedValue: number): number {
  return Math.floor(Date.now() / 1000) + storedValue; // storedValue is negative
}

/** Atomically claim an answer for follow-up task creation (true for exactly one caller). */
export function claimAnswerForTask(answerId: number, token: number): boolean {
  const res = getDb().prepare(
    'UPDATE closing_answers SET task_line_id = ? WHERE id = ? AND task_line_id IS NULL',
  ).run(token, answerId);
  return res.changes > 0;
}

/** Take over a claim someone else abandoned (compare-and-swap on the old token). */
export function takeOverClaim(answerId: number, oldToken: number, newToken: number): boolean {
  const res = getDb().prepare(
    'UPDATE closing_answers SET task_line_id = ? WHERE id = ? AND task_line_id = ?',
  ).run(newToken, answerId, oldToken);
  return res.changes > 0;
}

/** Release MY claim after a failed Odoo write (never clobbers someone else's). */
export function releaseClaim(answerId: number, token: number): void {
  getDb().prepare(
    'UPDATE closing_answers SET task_line_id = NULL WHERE id = ? AND task_line_id = ?',
  ).run(answerId, token);
}

export function getAnswerWithReport(answerId: number): { answer: ClosingAnswer; report: ClosingReport } | null {
  const row = getDb().prepare('SELECT report_id FROM closing_answers WHERE id = ?').get(answerId) as { report_id: number } | undefined;
  if (!row) return null;
  const report = getReportById(row.report_id);
  const answer = report?.answers.find((a) => a.id === answerId);
  return report && answer ? { answer, report } : null;
}

/** The night's questionnaire as frozen in a submitted report — pre-lock
 *  corrections validate against THIS, never the live (possibly edited) template. */
export function questionsFromSnapshot(report: ClosingReport): QuestionDef[] {
  return report.answers
    .filter((a) => a.question_id != null)
    .map((a) => ({
      id: a.question_id as number,
      position: a.position,
      text: a.question_text,
      qtype: a.qtype,
      options: a.options,
      problem_values: a.problem_values,
    }));
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export interface ClosingTrends {
  submitted_dates: string[];
  rating_by_date: { date: string; avg: number }[];
  problem_counts: { question_text: string; count: number }[];
  problems_total: number;
}

export function trendsData(companyId: number, departmentId: number, sinceDate: string): ClosingTrends {
  const db = getDb();
  const submitted = db.prepare(`
    SELECT report_date FROM closing_reports
    WHERE company_id = ? AND department_id = ? AND report_date >= ?
    ORDER BY report_date
  `).all(companyId, departmentId, sinceDate) as { report_date: string }[];

  const ratings = db.prepare(`
    SELECT r.report_date AS date, AVG(CAST(a.value AS REAL)) AS avg
    FROM closing_answers a JOIN closing_reports r ON r.id = a.report_id
    WHERE r.company_id = ? AND r.department_id = ? AND r.report_date >= ? AND a.qtype = 'rating'
    GROUP BY r.report_date ORDER BY r.report_date
  `).all(companyId, departmentId, sinceDate) as { date: string; avg: number }[];

  const problems = db.prepare(`
    SELECT a.question_text, COUNT(*) AS count
    FROM closing_answers a JOIN closing_reports r ON r.id = a.report_id
    WHERE r.company_id = ? AND r.department_id = ? AND r.report_date >= ? AND a.is_problem = 1
    GROUP BY a.question_text ORDER BY count DESC, a.question_text
  `).all(companyId, departmentId, sinceDate) as { question_text: string; count: number }[];

  return {
    submitted_dates: submitted.map((r) => r.report_date),
    rating_by_date: ratings.map((r) => ({ date: r.date, avg: Math.round(r.avg * 10) / 10 })),
    problem_counts: problems,
    problems_total: problems.reduce((s, p) => s + p.count, 0),
  };
}

// ---------------------------------------------------------------------------
// Settings + morning-email claim
// ---------------------------------------------------------------------------

export function getSettings(companyId: number): { missing_email_enabled: boolean } {
  const r = getDb().prepare('SELECT missing_email_enabled FROM closing_settings WHERE company_id = ?')
    .get(companyId) as { missing_email_enabled: number } | undefined;
  return { missing_email_enabled: !!r?.missing_email_enabled };
}

export function setMissingEmail(companyId: number, enabled: boolean): void {
  getDb().prepare(`
    INSERT INTO closing_settings (company_id, missing_email_enabled, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (company_id) DO UPDATE SET missing_email_enabled = excluded.missing_email_enabled, updated_at = excluded.updated_at
  `).run(companyId, enabled ? 1 : 0, nowISO());
}

export function companiesWithMissingEmail(): number[] {
  const rows = getDb().prepare('SELECT company_id FROM closing_settings WHERE missing_email_enabled = 1').all() as { company_id: number }[];
  return rows.map((r) => r.company_id);
}

/** Atomic once-per-night claim — true exactly once per (company, night). */
export function claimMissingEmail(companyId: number, reportDate: string): boolean {
  const res = getDb().prepare(
    'INSERT OR IGNORE INTO closing_email_log (company_id, report_date, sent_at) VALUES (?, ?, ?)',
  ).run(companyId, reportDate, nowISO());
  return res.changes > 0;
}

/** Give the night back when NO email at all went out, so the next run retries. */
export function releaseMissingEmailClaim(companyId: number, reportDate: string): void {
  getDb().prepare(
    'DELETE FROM closing_email_log WHERE company_id = ? AND report_date = ?',
  ).run(companyId, reportDate);
}

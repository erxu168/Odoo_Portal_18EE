/**
 * Staff Lifecycle Checklists — SQLite schema & CRUD.
 *
 * Four tables: staffing_templates, staffing_template_tasks, staffing_instances,
 * staffing_instance_tasks. Templates are the master lists (base/team/level);
 * starting a stage MERGES the relevant templates and SNAPSHOTS the tasks onto an
 * instance so later template edits never rewrite live checklists. Portal-native;
 * Odoo is read-only (the caller passes resolved employee context in).
 *
 * Lazy init matches issues-db.ts / kds-db.ts. Berlin time only (never toISOString()).
 */
import { getDb, getUserByEmployeeId } from './db';
import { mergeTaskSeeds, computeDueDate } from './staffing-logic';
import type {
  TemplateRow, TemplateTaskRow, InstanceRow, InstanceTaskRow,
  CreateTemplateInput, UpsertTemplateTaskInput, TemplateTaskSeed,
  Stage, Scope, TaskStatus,
} from '@/types/staffing';

/** Thrown when a start would produce zero tasks (no base/target template configured). */
export class SetupIncompleteError extends Error {
  constructor(message = 'Checklist setup incomplete') {
    super(message);
    this.name = 'SetupIncompleteError';
  }
}

/** Berlin timestamp (matches issues-db / kds-db). Never toISOString(). */
function nowISO(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T');
}

let _init = false;
function ensureStaffingTables(): void {
  if (_init) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS staffing_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('joining','promotion','leaving')),
      scope TEXT NOT NULL CHECK (scope IN ('base','team','level')),
      department_id INTEGER,
      target_level TEXT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staffing_tpl_scope ON staffing_templates(company_id, stage, scope);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_staffing_tpl_base
      ON staffing_templates(company_id, stage) WHERE scope = 'base' AND active = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_staffing_tpl_team
      ON staffing_templates(company_id, stage, department_id) WHERE scope = 'team' AND active = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_staffing_tpl_level
      ON staffing_templates(company_id, target_level) WHERE scope = 'level' AND active = 1;

    CREATE TABLE IF NOT EXISTS staffing_template_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES staffing_templates(id) ON DELETE CASCADE,
      audience TEXT NOT NULL DEFAULT 'business' CHECK (audience IN ('business','employee')),
      title TEXT NOT NULL,
      description TEXT,
      sequence INTEGER NOT NULL DEFAULT 0,
      responsible_type TEXT NOT NULL DEFAULT 'employee_manager'
        CHECK (responsible_type IN ('specific_user','employee_manager','the_employee')),
      responsible_user_id INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
      due_offset_days INTEGER,
      reminder INTEGER NOT NULL DEFAULT 0 CHECK (reminder IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
    );
    CREATE INDEX IF NOT EXISTS idx_staffing_tpl_tasks ON staffing_template_tasks(template_id);

    CREATE TABLE IF NOT EXISTS staffing_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('joining','promotion','leaving')),
      department_id INTEGER,
      department_name TEXT,
      target_level TEXT,
      from_level TEXT,
      reference_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
      started_by INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
      started_at TEXT NOT NULL,
      termination_id INTEGER,
      start_key TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_staffing_inst_startkey ON staffing_instances(start_key);
    -- At most one OPEN instance per (employee, stage) — the concurrency backstop.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_staffing_inst_open
      ON staffing_instances(employee_id, stage) WHERE status = 'open';
    CREATE INDEX IF NOT EXISTS idx_staffing_inst_emp ON staffing_instances(employee_id);
    CREATE INDEX IF NOT EXISTS idx_staffing_inst_co ON staffing_instances(company_id, status);

    CREATE TABLE IF NOT EXISTS staffing_instance_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES staffing_instances(id) ON DELETE CASCADE,
      audience TEXT NOT NULL DEFAULT 'business' CHECK (audience IN ('business','employee')),
      title TEXT NOT NULL,
      description TEXT,
      sequence INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'base' CHECK (source IN ('base','team','level')),
      assignee_user_id INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
      assignee_employee_id INTEGER,
      due_date TEXT,
      reminder INTEGER NOT NULL DEFAULT 0 CHECK (reminder IN (0,1)),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
      done_by INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
      done_at TEXT,
      note TEXT,
      reminder_stage INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_staffing_inst_tasks ON staffing_instance_tasks(instance_id);
    CREATE INDEX IF NOT EXISTS idx_staffing_reminder_scan
      ON staffing_instance_tasks(status, reminder, due_date, reminder_stage);
    CREATE INDEX IF NOT EXISTS idx_staffing_inst_tasks_emp ON staffing_instance_tasks(assignee_employee_id);
  `);
  _init = true;
}

// --- Templates -------------------------------------------------------------

export function createTemplate(input: CreateTemplateInput): number {
  ensureStaffingTables();
  const now = nowISO();
  const r = getDb().prepare(`
    INSERT INTO staffing_templates
      (company_id, stage, scope, department_id, target_level, name, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(input.company_id, input.stage, input.scope,
         input.department_id ?? null, input.target_level ?? null, input.name, now, now);
  return Number(r.lastInsertRowid);
}

export function listTemplates(companyId: number): TemplateRow[] {
  ensureStaffingTables();
  return getDb().prepare(
    `SELECT * FROM staffing_templates WHERE company_id = ? AND active = 1 ORDER BY stage, scope, name`,
  ).all(companyId) as TemplateRow[];
}

export interface TemplateWithCounts extends TemplateRow {
  task_count: number;
  business_count: number;
  employee_count: number;
}

/** Templates for a company, each with its active task counts (for the Setup screen). */
export function listTemplatesWithCounts(companyId: number): TemplateWithCounts[] {
  ensureStaffingTables();
  return getDb().prepare(`
    SELECT s.*,
      COUNT(t.id) AS task_count,
      SUM(CASE WHEN t.audience = 'business' THEN 1 ELSE 0 END) AS business_count,
      SUM(CASE WHEN t.audience = 'employee' THEN 1 ELSE 0 END) AS employee_count
    FROM staffing_templates s
    LEFT JOIN staffing_template_tasks t ON t.template_id = s.id AND t.active = 1
    WHERE s.company_id = ? AND s.active = 1
    GROUP BY s.id
    ORDER BY s.stage, s.scope, s.name
  `).all(companyId) as TemplateWithCounts[];
}

export function getTemplate(id: number): TemplateRow | null {
  ensureStaffingTables();
  return (getDb().prepare('SELECT * FROM staffing_templates WHERE id = ?').get(id) as TemplateRow) || null;
}

export function updateTemplate(id: number, patch: Partial<Pick<TemplateRow, 'name' | 'active'>>): void {
  ensureStaffingTables();
  const cur = getTemplate(id);
  if (!cur) return;
  getDb().prepare('UPDATE staffing_templates SET name = ?, active = ?, updated_at = ? WHERE id = ?')
    .run(patch.name ?? cur.name, patch.active ?? cur.active, nowISO(), id);
}

export function deleteTemplate(id: number): void {
  ensureStaffingTables();
  getDb().prepare('DELETE FROM staffing_templates WHERE id = ?').run(id);
}

// --- Template tasks --------------------------------------------------------

export function listTemplateTasks(templateId: number): TemplateTaskRow[] {
  ensureStaffingTables();
  return getDb().prepare(
    `SELECT * FROM staffing_template_tasks WHERE template_id = ? AND active = 1 ORDER BY audience, sequence, id`,
  ).all(templateId) as TemplateTaskRow[];
}

export function addTemplateTask(templateId: number, t: UpsertTemplateTaskInput): number {
  ensureStaffingTables();
  const r = getDb().prepare(`
    INSERT INTO staffing_template_tasks
      (template_id, audience, title, description, sequence, responsible_type,
       responsible_user_id, due_offset_days, reminder, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(templateId, t.audience, t.title, t.description ?? null, t.sequence ?? 0,
         t.responsible_type, t.responsible_user_id ?? null, t.due_offset_days ?? null, t.reminder ? 1 : 0);
  return Number(r.lastInsertRowid);
}

/** Update a task scoped to its template (prevents cross-template/company task edits). */
export function updateTemplateTask(taskId: number, templateId: number, t: UpsertTemplateTaskInput): boolean {
  ensureStaffingTables();
  const r = getDb().prepare(`
    UPDATE staffing_template_tasks SET
      audience = ?, title = ?, description = ?, sequence = ?, responsible_type = ?,
      responsible_user_id = ?, due_offset_days = ?, reminder = ?
    WHERE id = ? AND template_id = ?
  `).run(t.audience, t.title, t.description ?? null, t.sequence ?? 0, t.responsible_type,
         t.responsible_user_id ?? null, t.due_offset_days ?? null, t.reminder ? 1 : 0, taskId, templateId);
  return r.changes === 1;
}

/** Delete a task scoped to its template. Returns false if it did not belong to the template. */
export function deleteTemplateTask(taskId: number, templateId: number): boolean {
  ensureStaffingTables();
  const r = getDb().prepare('DELETE FROM staffing_template_tasks WHERE id = ? AND template_id = ?').run(taskId, templateId);
  return r.changes === 1;
}

/** Atomic bulk reorder: apply new sequence to each task id (all-or-nothing). */
export function reorderTemplateTasks(templateId: number, orderedIds: number[]): void {
  ensureStaffingTables();
  const db = getDb();
  const stmt = db.prepare('UPDATE staffing_template_tasks SET sequence = ? WHERE id = ? AND template_id = ?');
  db.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, id, templateId)))();
}

export function findBaseTemplate(companyId: number, stage: Stage): TemplateRow | null {
  ensureStaffingTables();
  return (getDb().prepare(
    `SELECT * FROM staffing_templates WHERE company_id = ? AND stage = ? AND scope = 'base' AND active = 1 LIMIT 1`,
  ).get(companyId, stage) as TemplateRow) || null;
}

export function findTeamTemplate(companyId: number, stage: Stage, departmentId: number): TemplateRow | null {
  ensureStaffingTables();
  return (getDb().prepare(
    `SELECT * FROM staffing_templates
     WHERE company_id = ? AND stage = ? AND scope = 'team' AND department_id = ? AND active = 1 LIMIT 1`,
  ).get(companyId, stage, departmentId) as TemplateRow) || null;
}

export function findLevelTemplate(companyId: number, targetLevel: string): TemplateRow | null {
  ensureStaffingTables();
  return (getDb().prepare(
    `SELECT * FROM staffing_templates
     WHERE company_id = ? AND stage = 'promotion' AND scope = 'level' AND target_level = ? AND active = 1 LIMIT 1`,
  ).get(companyId, targetLevel) as TemplateRow) || null;
}

// --- Instances (start / merge / snapshot / read / tick) --------------------

export interface StartInstanceParams {
  employeeId: number;
  companyId: number;
  stage: Stage;
  departmentId: number | null;    // joining/leaving
  departmentName: string | null;  // snapshot
  targetLevel: string | null;     // promotion
  fromLevel: string | null;       // promotion history
  referenceDate: string;          // YYYY-MM-DD
  startedBy: number;              // portal user id
  terminationId: number | null;
  managerEmployeeId: number | null;
  adminUserId: number | null;     // fallback assignee for employee_manager
  startKey: string;               // idempotency key
}

function seedsFrom(row: { id: number; scope: Scope }): TemplateTaskSeed[] {
  return listTemplateTasks(row.id).map(t => ({
    audience: t.audience, title: t.title, description: t.description, sequence: t.sequence,
    responsible_type: t.responsible_type, responsible_user_id: t.responsible_user_id,
    due_offset_days: t.due_offset_days, reminder: !!t.reminder, source: row.scope,
  }));
}

/** Resolve a seed's responsible into (assignee_user_id, assignee_employee_id). */
function resolveAssignee(
  seed: TemplateTaskSeed, p: StartInstanceParams,
): { user: number | null; emp: number | null } {
  if (seed.responsible_type === 'specific_user') {
    return { user: seed.responsible_user_id, emp: null };
  }
  if (seed.responsible_type === 'the_employee') {
    const u = getUserByEmployeeId(p.employeeId);
    return { user: u?.id ?? null, emp: p.employeeId };
  }
  // employee_manager
  if (p.managerEmployeeId != null) {
    const u = getUserByEmployeeId(p.managerEmployeeId);
    if (u) return { user: u.id, emp: p.managerEmployeeId };
  }
  return { user: p.adminUserId, emp: null };
}

/**
 * Gather + merge the seeds a start would produce (base+team, or the level list).
 * Joining/Leaving REQUIRE an active base template — a team-only config must not
 * start a checklist without the shared base. Returns [] when setup is incomplete.
 */
function gatherSeeds(companyId: number, stage: Stage, departmentId: number | null, targetLevel: string | null): TemplateTaskSeed[] {
  if (stage === 'promotion') {
    const lvl = targetLevel ? findLevelTemplate(companyId, targetLevel) : null;
    return lvl ? seedsFrom(lvl) : [];
  }
  const base = findBaseTemplate(companyId, stage);
  if (!base) return []; // no shared base configured → setup incomplete
  const team = departmentId != null ? findTeamTemplate(companyId, stage, departmentId) : null;
  return mergeTaskSeeds(seedsFrom(base), team ? seedsFrom(team) : []);
}

/** Non-destructive preview of what a start would create (for the confirm prompt). */
export function previewMergedTasks(
  companyId: number, stage: Stage, departmentId: number | null, targetLevel: string | null,
): { total: number; business: number; employee: number; hasBase: boolean; hasTeam: boolean } {
  ensureStaffingTables();
  const seeds = gatherSeeds(companyId, stage, departmentId, targetLevel);
  return {
    total: seeds.length,
    business: seeds.filter(s => s.audience === 'business').length,
    employee: seeds.filter(s => s.audience === 'employee').length,
    hasBase: seeds.some(s => s.source === 'base') || stage === 'promotion',
    hasTeam: seeds.some(s => s.source === 'team'),
  };
}

export function startInstance(p: StartInstanceParams): number {
  ensureStaffingTables();
  const db = getDb();

  // Idempotency: a repeated start (double-click/retry) returns the existing instance.
  const dup = db.prepare('SELECT id FROM staffing_instances WHERE start_key = ?').get(p.startKey) as { id: number } | undefined;
  if (dup) return dup.id;

  const seeds = gatherSeeds(p.companyId, p.stage, p.departmentId, p.targetLevel);
  if (seeds.length === 0) throw new SetupIncompleteError();

  const tx = db.transaction(() => {
    const inst = db.prepare(`
      INSERT INTO staffing_instances
        (employee_id, company_id, stage, department_id, department_name, target_level, from_level,
         reference_date, status, started_by, started_at, termination_id, start_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(p.employeeId, p.companyId, p.stage, p.departmentId, p.departmentName, p.targetLevel, p.fromLevel,
           p.referenceDate, p.startedBy, nowISO(), p.terminationId, p.startKey);
    const instanceId = Number(inst.lastInsertRowid);
    const insTask = db.prepare(`
      INSERT INTO staffing_instance_tasks
        (instance_id, audience, title, description, sequence, source,
         assignee_user_id, assignee_employee_id, due_date, reminder, status, reminder_stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
    `);
    for (const s of seeds) {
      const who = resolveAssignee(s, p);
      insTask.run(instanceId, s.audience, s.title, s.description, s.sequence, s.source,
        who.user, who.emp, computeDueDate(p.referenceDate, s.due_offset_days), s.reminder ? 1 : 0);
    }
    return instanceId;
  });

  try {
    return tx();
  } catch (err: unknown) {
    // Concurrent identical start hit the unique start_key — return the winner.
    const byKey = db.prepare('SELECT id FROM staffing_instances WHERE start_key = ?').get(p.startKey) as { id: number } | undefined;
    if (byKey) return byKey.id;
    // Concurrent DIFFERENT-key start hit the one-open-per-stage unique index — return that winner.
    const openSame = db.prepare(
      `SELECT id FROM staffing_instances WHERE employee_id = ? AND stage = ? AND status = 'open' LIMIT 1`,
    ).get(p.employeeId, p.stage) as { id: number } | undefined;
    if (openSame) return openSame.id;
    throw err;
  }
}

export function getInstancesForEmployee(employeeId: number): InstanceRow[] {
  ensureStaffingTables();
  return getDb().prepare(
    `SELECT * FROM staffing_instances WHERE employee_id = ? ORDER BY started_at DESC`,
  ).all(employeeId) as InstanceRow[];
}

export function getInstanceCounts(instanceId: number): { total: number; done: number } {
  ensureStaffingTables();
  const r = getDb().prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS done
    FROM staffing_instance_tasks WHERE instance_id = ?
  `).get(instanceId) as { total: number; done: number | null };
  return { total: r.total, done: r.done ?? 0 };
}

export function getInstance(id: number): { instance: InstanceRow; tasks: InstanceTaskRow[] } | null {
  ensureStaffingTables();
  const instance = getDb().prepare('SELECT * FROM staffing_instances WHERE id = ?').get(id) as InstanceRow | undefined;
  if (!instance) return null;
  const tasks = getDb().prepare(
    `SELECT * FROM staffing_instance_tasks WHERE instance_id = ? ORDER BY audience, sequence, id`,
  ).all(id) as InstanceTaskRow[];
  return { instance, tasks };
}

export function setTaskStatus(
  taskId: number, p: { status: TaskStatus; done_by: number | null; note?: string | null },
): void {
  ensureStaffingTables();
  const db = getDb();
  const doneAt = p.status === 'pending' ? null : nowISO();
  db.prepare(
    `UPDATE staffing_instance_tasks SET status = ?, done_by = ?, done_at = ?, note = COALESCE(?, note) WHERE id = ?`,
  ).run(p.status, p.status === 'pending' ? null : p.done_by, doneAt, p.note ?? null, taskId);
  // Auto-close an OPEN instance when no pending tasks remain. We only ever touch
  // an 'open' instance (never a done/cancelled one), so un-ticking a task in a
  // completed checklist can NOT reopen it — that would clash with the
  // one-open-per-stage unique index and leave inconsistent state.
  const row = db.prepare('SELECT instance_id FROM staffing_instance_tasks WHERE id = ?').get(taskId) as { instance_id: number } | undefined;
  if (row) {
    const pending = db.prepare(
      `SELECT COUNT(*) AS n FROM staffing_instance_tasks WHERE instance_id = ? AND status = 'pending'`,
    ).get(row.instance_id) as { n: number };
    if (pending.n === 0) {
      db.prepare(`UPDATE staffing_instances SET status = 'done' WHERE id = ? AND status = 'open'`).run(row.instance_id);
    }
  }
}

/** The instance a task belongs to (for authz: employee ticking their own). */
export function getTaskWithInstance(taskId: number): { task: InstanceTaskRow; instance: InstanceRow } | null {
  ensureStaffingTables();
  const task = getDb().prepare('SELECT * FROM staffing_instance_tasks WHERE id = ?').get(taskId) as InstanceTaskRow | undefined;
  if (!task) return null;
  const instance = getDb().prepare('SELECT * FROM staffing_instances WHERE id = ?').get(task.instance_id) as InstanceRow | undefined;
  if (!instance) return null;
  return { task, instance };
}

/** Cancel an OPEN instance only. Returns false if it was already done/cancelled. */
export function cancelInstance(id: number): boolean {
  ensureStaffingTables();
  const r = getDb().prepare(`UPDATE staffing_instances SET status = 'cancelled' WHERE id = ? AND status = 'open'`).run(id);
  return r.changes === 1;
}

export function getMyPendingEmployeeTasks(employeeId: number): (InstanceTaskRow & { stage: Stage; instance_status: string })[] {
  ensureStaffingTables();
  return getDb().prepare(`
    SELECT t.*, i.stage AS stage, i.status AS instance_status
    FROM staffing_instance_tasks t
    JOIN staffing_instances i ON i.id = t.instance_id
    WHERE t.assignee_employee_id = ? AND t.audience = 'employee'
      AND t.status = 'pending' AND i.status = 'open'
    ORDER BY (t.due_date IS NULL), t.due_date, t.sequence
  `).all(employeeId) as (InstanceTaskRow & { stage: Stage; instance_status: string })[];
}

// --- Reminders (Task 14) ---------------------------------------------------

export function listReminderCandidates(): (InstanceTaskRow & { stage: Stage; employee_id: number })[] {
  ensureStaffingTables();
  // No assignee_user_id filter — employee tasks may have a null stored user
  // (new hire not yet provisioned); the cron resolves the live user by employee id.
  return getDb().prepare(`
    SELECT t.*, i.stage AS stage, i.employee_id AS employee_id
    FROM staffing_instance_tasks t
    JOIN staffing_instances i ON i.id = t.instance_id
    WHERE t.status = 'pending' AND t.reminder = 1 AND t.due_date IS NOT NULL AND i.status = 'open'
  `).all() as (InstanceTaskRow & { stage: Stage; employee_id: number })[];
}

/** Atomically claim a reminder stage. Returns true only if THIS call advanced it. */
export function claimReminderStage(taskId: number, stage: number): boolean {
  ensureStaffingTables();
  const r = getDb().prepare(`
    UPDATE staffing_instance_tasks SET reminder_stage = ?
    WHERE id = ? AND status = 'pending' AND reminder_stage < ?
      AND EXISTS (SELECT 1 FROM staffing_instances i WHERE i.id = instance_id AND i.status = 'open')
  `).run(stage, taskId, stage);
  return r.changes === 1;
}

/**
 * Count of overdue, still-pending tasks in open instances (Needs attention badge).
 * companyIds = null → all companies (admins); otherwise scoped to that list.
 */
export function countOverdueOpenTasks(companyIds: number[] | null, todayISO: string): number {
  ensureStaffingTables();
  const base = `SELECT COUNT(*) AS n
    FROM staffing_instance_tasks t JOIN staffing_instances i ON i.id = t.instance_id
    WHERE i.status = 'open' AND t.status = 'pending'
      AND t.due_date IS NOT NULL AND t.due_date < ?`;
  if (companyIds && companyIds.length) {
    const ph = companyIds.map(() => '?').join(',');
    const r = getDb().prepare(`${base} AND i.company_id IN (${ph})`).get(todayISO, ...companyIds) as { n: number };
    return r.n;
  }
  const r = getDb().prepare(base).get(todayISO) as { n: number };
  return r.n;
}

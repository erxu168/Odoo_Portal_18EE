/**
 * odoo-tasks.ts
 * Data layer for the Department Task Manager.
 *
 * Backed by the `krawings_task_manager` Odoo addon (krawings.task.list,
 * krawings.task.template, etc.). No planning.slot dependency — task lists
 * are owned by hr.department and spawned daily by Odoo cron.
 */

import { getOdoo } from './odoo';

// ── Types ─────────────────────────────────────

export type DayPart = 'opening' | 'mid_day' | 'closing';
export type LineState = 'pending' | 'done' | 'overdue';
export type ModuleLink = 'none' | 'inventory' | 'purchase' | 'pos' | 'manufacturing';
export type ListState = 'draft' | 'in_progress' | 'done';

export interface TaskSubtask {
  id: number;
  name: string;
  sequence: number;
  done: boolean;
  toggled_at: string | null;
  toggled_by_id: number | null;
}

export interface TaskListLine {
  id: number;
  name: string;
  sequence: number;
  day_part: DayPart;
  deadline_datetime: string | null;
  photo_required: boolean;
  photo_uploaded: boolean;
  module_link_type: ModuleLink;
  state: LineState;
  completed_at: string | null;
  completed_by_id: number | null;
  completed_by_name: string | null;
  is_ad_hoc: boolean;
  source_template_line_id: number | null;
  subtasks: TaskSubtask[];
}

export interface TaskList {
  id: number;
  date: string;            // YYYY-MM-DD
  department_id: number;
  department_name: string;
  company_id: number;
  template_id: number | null;
  template_name: string | null;
  state: ListState;
  completion_rate: number;
  line_count: number;
  completed_count: number;
  overdue_count: number;
  photo_pending_count: number;
  lines: TaskListLine[];
}

export interface TaskListSummary {
  id: number;
  date: string;
  department_id: number;
  department_name: string;
  company_id: number;
  state: ListState;
  completion_rate: number;
  line_count: number;
  overdue_count: number;
  photo_pending_count: number;
}

export interface TaskTemplateLine {
  id: number;
  name: string;
  sequence: number;
  day_part: DayPart;
  deadline_time: number | null;   // Float hours, e.g. 14.5 = 14:30
  photo_required: boolean;
  module_link_type: ModuleLink;
  subtasks: { id: number; name: string; sequence: number }[];
}

export interface TaskTemplate {
  id: number;
  name: string;
  active: boolean;
  department_id: number;
  department_name: string;
  company_id: number;
  days_of_week: { mon: boolean; tue: boolean; wed: boolean; thu: boolean; fri: boolean; sat: boolean; sun: boolean };
  line_count: number;
  lines: TaskTemplateLine[];
}

export interface TaskTemplateSummary {
  id: number;
  name: string;
  active: boolean;
  department_id: number;
  department_name: string;
  company_id: number;
  days_of_week: TaskTemplate['days_of_week'];
  line_count: number;
}

export interface EmployeeContext {
  employee_id: number;
  employee_name: string;
  department_id: number | null;
  department_name: string | null;
  company_id: number | null;
}

export interface DashboardData {
  date: string;                // YYYY-MM-DD
  department_count: number;
  active_lists: number;
  avg_completion: number;
  total_overdue: number;
  total_photos_pending: number;
  lists: TaskListSummary[];
}

// ── Helpers ───────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function odooDtToIso(dt: string | false | null): string | null {
  if (!dt) return null;
  // Odoo returns "YYYY-MM-DD HH:MM:SS" in UTC, no timezone marker
  return new Date(`${dt.replace(' ', 'T')}Z`).toISOString();
}

function m2oId(field: any): number | null {
  if (!field) return null;
  if (Array.isArray(field)) return field[0] ?? null;
  return field;
}

function m2oName(field: any): string | null {
  if (!field) return null;
  if (Array.isArray(field)) return field[1] ?? null;
  return null;
}

// ── Employee / context ────────────────────────

export async function getEmployeeContext(employeeId: number): Promise<EmployeeContext | null> {
  if (!employeeId) return null;
  const rows = await getOdoo().searchRead(
    'hr.employee',
    [['id', '=', employeeId]],
    ['id', 'name', 'department_id', 'company_id'],
    { limit: 1 },
  );
  if (!rows.length) return null;
  const e = rows[0];
  return {
    employee_id: e.id,
    employee_name: e.name,
    department_id: m2oId(e.department_id),
    department_name: m2oName(e.department_id),
    company_id: m2oId(e.company_id),
  };
}

// ── Lists ─────────────────────────────────────

const LIST_FIELDS = [
  'id', 'date', 'department_id', 'company_id', 'template_id', 'state',
  'completion_rate', 'line_count', 'completed_count', 'overdue_count',
  'photo_pending_count', 'line_ids',
];

const LINE_FIELDS = [
  'id', 'list_id', 'name', 'sequence', 'day_part', 'deadline_datetime',
  'photo_required', 'photo_uploaded', 'module_link_type', 'state',
  'completed_at', 'completed_by_id', 'completed_by_name',
  'is_ad_hoc', 'source_template_line_id', 'subtask_ids',
];

const SUBTASK_FIELDS = [
  'id', 'line_id', 'name', 'sequence', 'done', 'toggled_at', 'toggled_by_id',
];

async function hydrateListRecord(rec: any): Promise<TaskList> {
  const odoo = getOdoo();
  const lineIds: number[] = rec.line_ids || [];
  const lines = lineIds.length
    ? await odoo.searchRead('krawings.task.list.line', [['id', 'in', lineIds]], LINE_FIELDS, { limit: 500 })
    : [];

  const allSubtaskIds = lines.flatMap((l: any) => l.subtask_ids || []);
  const subtasks = allSubtaskIds.length
    ? await odoo.searchRead('krawings.task.list.subtask', [['id', 'in', allSubtaskIds]], SUBTASK_FIELDS, { limit: 1000 })
    : [];
  const subtasksByLine = new Map<number, TaskSubtask[]>();
  for (const s of subtasks) {
    const lid = m2oId(s.line_id)!;
    const arr = subtasksByLine.get(lid) || [];
    arr.push({
      id: s.id,
      name: s.name,
      sequence: s.sequence,
      done: !!s.done,
      toggled_at: odooDtToIso(s.toggled_at),
      toggled_by_id: m2oId(s.toggled_by_id),
    });
    subtasksByLine.set(lid, arr);
  }
  Array.from(subtasksByLine.values()).forEach(arr => arr.sort((a, b) => a.sequence - b.sequence));

  const hydratedLines: TaskListLine[] = lines.map((l: any) => ({
    id: l.id,
    name: l.name,
    sequence: l.sequence,
    day_part: l.day_part,
    deadline_datetime: odooDtToIso(l.deadline_datetime),
    photo_required: !!l.photo_required,
    photo_uploaded: !!l.photo_uploaded,
    module_link_type: (l.module_link_type || 'none') as ModuleLink,
    state: l.state as LineState,
    completed_at: odooDtToIso(l.completed_at),
    completed_by_id: m2oId(l.completed_by_id),
    completed_by_name: l.completed_by_name || null,
    is_ad_hoc: !!l.is_ad_hoc,
    source_template_line_id: m2oId(l.source_template_line_id),
    subtasks: subtasksByLine.get(l.id) || [],
  }));

  // Sort: opening → mid_day → closing, then sequence
  const order: Record<DayPart, number> = { opening: 1, mid_day: 2, closing: 3 };
  hydratedLines.sort((a, b) => order[a.day_part] - order[b.day_part] || a.sequence - b.sequence);

  return {
    id: rec.id,
    date: rec.date,
    department_id: m2oId(rec.department_id)!,
    department_name: m2oName(rec.department_id) || '',
    company_id: m2oId(rec.company_id)!,
    template_id: m2oId(rec.template_id),
    template_name: m2oName(rec.template_id),
    state: rec.state as ListState,
    completion_rate: rec.completion_rate || 0,
    line_count: rec.line_count || 0,
    completed_count: rec.completed_count || 0,
    overdue_count: rec.overdue_count || 0,
    photo_pending_count: rec.photo_pending_count || 0,
    lines: hydratedLines,
  };
}

export async function getTodayListForDepartment(departmentId: number): Promise<TaskList | null> {
  if (!departmentId) return null;
  const rows = await getOdoo().searchRead(
    'krawings.task.list',
    [['date', '=', todayStr()], ['department_id', '=', departmentId]],
    LIST_FIELDS,
    { limit: 1 },
  );
  if (!rows.length) return null;
  return hydrateListRecord(rows[0]);
}

export async function getListById(id: number): Promise<TaskList | null> {
  const rows = await getOdoo().searchRead(
    'krawings.task.list', [['id', '=', id]], LIST_FIELDS, { limit: 1 },
  );
  if (!rows.length) return null;
  return hydrateListRecord(rows[0]);
}

export async function getListByDeptAndDate(departmentId: number, date: string): Promise<TaskList | null> {
  const rows = await getOdoo().searchRead(
    'krawings.task.list',
    [['department_id', '=', departmentId], ['date', '=', date]],
    LIST_FIELDS, { limit: 1 },
  );
  if (!rows.length) return null;
  return hydrateListRecord(rows[0]);
}

export async function listListsForDate(date: string, allowedCompanyIds: number[]): Promise<TaskListSummary[]> {
  const domain: any[] = [['date', '=', date]];
  if (allowedCompanyIds?.length) domain.push(['company_id', 'in', allowedCompanyIds]);
  const rows = await getOdoo().searchRead(
    'krawings.task.list',
    domain,
    ['id', 'date', 'department_id', 'company_id', 'state', 'completion_rate',
     'line_count', 'overdue_count', 'photo_pending_count'],
    { limit: 200, order: 'department_id' },
  );
  return rows.map((r: any) => ({
    id: r.id,
    date: r.date,
    department_id: m2oId(r.department_id)!,
    department_name: m2oName(r.department_id) || '',
    company_id: m2oId(r.company_id)!,
    state: r.state as ListState,
    completion_rate: r.completion_rate || 0,
    line_count: r.line_count || 0,
    overdue_count: r.overdue_count || 0,
    photo_pending_count: r.photo_pending_count || 0,
  }));
}

export async function getDashboard(allowedCompanyIds: number[]): Promise<DashboardData> {
  const date = todayStr();
  const lists = await listListsForDate(date, allowedCompanyIds);
  const active = lists.filter(l => l.state !== 'done').length;
  const avg = lists.length
    ? Math.round(lists.reduce((s, l) => s + l.completion_rate, 0) / lists.length)
    : 0;
  return {
    date,
    department_count: lists.length,
    active_lists: active,
    avg_completion: avg,
    total_overdue: lists.reduce((s, l) => s + l.overdue_count, 0),
    total_photos_pending: lists.reduce((s, l) => s + l.photo_pending_count, 0),
    lists,
  };
}

// ── Line mutations ────────────────────────────

export async function completeLine(lineId: number, employeeId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const Employee = getOdoo();
    await Employee.call('krawings.task.list.line', 'mark_done', [[lineId], employeeId]);
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to complete';
    return { ok: false, error: message };
  }
}

export async function uncompleteLine(lineId: number): Promise<void> {
  await getOdoo().call('krawings.task.list.line', 'mark_undone', [[lineId]]);
}

export async function toggleSubtask(subtaskId: number, done: boolean, employeeId: number): Promise<void> {
  await getOdoo().call(
    'krawings.task.list.subtask', 'toggle',
    [[subtaskId], done, employeeId],
  );
}

export async function addAdHocLine(
  listId: number,
  vals: { name: string; day_part: DayPart; deadline_datetime?: string | null; photo_required?: boolean; module_link_type?: ModuleLink },
): Promise<number> {
  const odooVals: any = {
    name: vals.name,
    day_part: vals.day_part,
    photo_required: !!vals.photo_required,
    module_link_type: vals.module_link_type || 'none',
  };
  if (vals.deadline_datetime) {
    // Convert ISO → "YYYY-MM-DD HH:MM:SS" UTC
    const d = new Date(vals.deadline_datetime);
    odooVals.deadline_datetime = d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return getOdoo().call('krawings.task.list', 'add_ad_hoc_line', [[listId], odooVals]);
}

export async function updateLine(
  lineId: number,
  vals: Partial<{ name: string; day_part: DayPart; deadline_datetime: string | null; photo_required: boolean; module_link_type: ModuleLink }>,
): Promise<void> {
  const odooVals: any = { ...vals };
  if (vals.deadline_datetime) {
    odooVals.deadline_datetime = new Date(vals.deadline_datetime).toISOString().slice(0, 19).replace('T', ' ');
  } else if (vals.deadline_datetime === null) {
    odooVals.deadline_datetime = false;
  }
  await getOdoo().write('krawings.task.list.line', [lineId], odooVals);
}

export async function deleteAdHocLine(lineId: number): Promise<void> {
  // Caller is responsible for confirming the line is ad-hoc; Odoo ACL enforces overall edit rights.
  await getOdoo().unlink('krawings.task.list.line', [lineId]);
}

// ── Photos ────────────────────────────────────

export async function uploadLinePhoto(lineId: number, fileName: string, base64Data: string): Promise<{ attachment_id: number }> {
  const id = await getOdoo().create('ir.attachment', {
    name: fileName,
    res_model: 'krawings.task.list.line',
    res_id: lineId,
    type: 'binary',
    datas: base64Data,
  });
  return { attachment_id: id };
}

// ── Templates ─────────────────────────────────

const TEMPLATE_FIELDS = [
  'id', 'name', 'active', 'department_id', 'company_id',
  'day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun',
  'line_count', 'line_ids',
];

const TEMPLATE_LINE_FIELDS = [
  'id', 'template_id', 'name', 'sequence', 'day_part', 'deadline_time',
  'photo_required', 'module_link_type', 'subtask_ids',
];

const TEMPLATE_SUBTASK_FIELDS = ['id', 'line_id', 'name', 'sequence'];

function templateDays(rec: any): TaskTemplate['days_of_week'] {
  return {
    mon: !!rec.day_mon, tue: !!rec.day_tue, wed: !!rec.day_wed, thu: !!rec.day_thu,
    fri: !!rec.day_fri, sat: !!rec.day_sat, sun: !!rec.day_sun,
  };
}

export async function listTemplates(allowedCompanyIds: number[], includeArchived = false): Promise<TaskTemplateSummary[]> {
  const domain: any[] = [];
  if (!includeArchived) domain.push(['active', '=', true]);
  if (allowedCompanyIds?.length) domain.push(['company_id', 'in', allowedCompanyIds]);
  const rows = await getOdoo().searchRead(
    'krawings.task.template', domain,
    ['id', 'name', 'active', 'department_id', 'company_id', 'line_count',
     'day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun'],
    { limit: 200, order: 'department_id, name' },
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    active: !!r.active,
    department_id: m2oId(r.department_id)!,
    department_name: m2oName(r.department_id) || '',
    company_id: m2oId(r.company_id)!,
    days_of_week: templateDays(r),
    line_count: r.line_count || 0,
  }));
}

export async function getTemplate(id: number): Promise<TaskTemplate | null> {
  const odoo = getOdoo();
  const rows = await odoo.searchRead('krawings.task.template', [['id', '=', id]], TEMPLATE_FIELDS, { limit: 1 });
  if (!rows.length) return null;
  const r = rows[0];
  const lineIds: number[] = r.line_ids || [];
  const lines = lineIds.length
    ? await odoo.searchRead('krawings.task.template.line', [['id', 'in', lineIds]], TEMPLATE_LINE_FIELDS, { limit: 500 })
    : [];
  const allSubtaskIds = lines.flatMap((l: any) => l.subtask_ids || []);
  const subtasks = allSubtaskIds.length
    ? await odoo.searchRead('krawings.task.template.subtask', [['id', 'in', allSubtaskIds]], TEMPLATE_SUBTASK_FIELDS, { limit: 1000 })
    : [];
  const subByLine = new Map<number, { id: number; name: string; sequence: number }[]>();
  for (const s of subtasks) {
    const lid = m2oId(s.line_id)!;
    const arr = subByLine.get(lid) || [];
    arr.push({ id: s.id, name: s.name, sequence: s.sequence });
    subByLine.set(lid, arr);
  }
  Array.from(subByLine.values()).forEach(arr => arr.sort((a, b) => a.sequence - b.sequence));
  const order: Record<DayPart, number> = { opening: 1, mid_day: 2, closing: 3 };
  const hydratedLines: TaskTemplateLine[] = lines.map((l: any) => ({
    id: l.id,
    name: l.name,
    sequence: l.sequence,
    day_part: l.day_part as DayPart,
    deadline_time: l.deadline_time === false ? null : l.deadline_time,
    photo_required: !!l.photo_required,
    module_link_type: (l.module_link_type || 'none') as ModuleLink,
    subtasks: subByLine.get(l.id) || [],
  }));
  hydratedLines.sort((a, b) => order[a.day_part] - order[b.day_part] || a.sequence - b.sequence);

  return {
    id: r.id,
    name: r.name,
    active: !!r.active,
    department_id: m2oId(r.department_id)!,
    department_name: m2oName(r.department_id) || '',
    company_id: m2oId(r.company_id)!,
    days_of_week: templateDays(r),
    line_count: r.line_count || 0,
    lines: hydratedLines,
  };
}

export interface TemplateLineInput {
  id?: number;       // omit for new lines
  name: string;
  sequence?: number;
  day_part: DayPart;
  deadline_time?: number | null;
  photo_required?: boolean;
  module_link_type?: ModuleLink;
  subtasks?: { id?: number; name: string; sequence?: number }[];
}

export interface TemplateInput {
  name: string;
  department_id: number;
  days_of_week: TaskTemplate['days_of_week'];
  active?: boolean;
}

export async function createTemplate(input: TemplateInput): Promise<number> {
  return getOdoo().create('krawings.task.template', {
    name: input.name,
    department_id: input.department_id,
    active: input.active !== false,
    day_mon: input.days_of_week.mon,
    day_tue: input.days_of_week.tue,
    day_wed: input.days_of_week.wed,
    day_thu: input.days_of_week.thu,
    day_fri: input.days_of_week.fri,
    day_sat: input.days_of_week.sat,
    day_sun: input.days_of_week.sun,
  });
}

export async function updateTemplate(id: number, input: Partial<TemplateInput>): Promise<void> {
  const vals: any = {};
  if (input.name !== undefined) vals.name = input.name;
  if (input.department_id !== undefined) vals.department_id = input.department_id;
  if (input.active !== undefined) vals.active = input.active;
  if (input.days_of_week) {
    vals.day_mon = input.days_of_week.mon;
    vals.day_tue = input.days_of_week.tue;
    vals.day_wed = input.days_of_week.wed;
    vals.day_thu = input.days_of_week.thu;
    vals.day_fri = input.days_of_week.fri;
    vals.day_sat = input.days_of_week.sat;
    vals.day_sun = input.days_of_week.sun;
  }
  await getOdoo().write('krawings.task.template', [id], vals);
}

export async function archiveTemplate(id: number): Promise<void> {
  await getOdoo().write('krawings.task.template', [id], { active: false });
}

export async function unarchiveTemplate(id: number): Promise<void> {
  await getOdoo().write('krawings.task.template', [id], { active: true });
}

export async function upsertTemplateLine(templateId: number, line: TemplateLineInput): Promise<number> {
  const odoo = getOdoo();
  const vals: any = {
    template_id: templateId,
    name: line.name,
    sequence: line.sequence ?? 10,
    day_part: line.day_part,
    deadline_time: line.deadline_time ?? false,
    photo_required: !!line.photo_required,
    module_link_type: line.module_link_type || 'none',
  };
  let lineId = line.id;
  if (lineId) {
    await odoo.write('krawings.task.template.line', [lineId], vals);
  } else {
    lineId = await odoo.create('krawings.task.template.line', vals);
  }
  if (line.subtasks) {
    // Replace strategy: delete missing, upsert provided
    const existing = await odoo.searchRead(
      'krawings.task.template.subtask',
      [['line_id', '=', lineId]], ['id'], { limit: 200 },
    );
    const keepIds = new Set(line.subtasks.filter(s => s.id).map(s => s.id));
    const toDelete = existing.filter((e: any) => !keepIds.has(e.id)).map((e: any) => e.id);
    if (toDelete.length) await odoo.unlink('krawings.task.template.subtask', toDelete);
    for (const s of line.subtasks) {
      const sVals = { line_id: lineId, name: s.name, sequence: s.sequence ?? 10 };
      if (s.id) await odoo.write('krawings.task.template.subtask', [s.id], sVals);
      else await odoo.create('krawings.task.template.subtask', sVals);
    }
  }
  return lineId;
}

export async function deleteTemplateLine(lineId: number): Promise<void> {
  await getOdoo().unlink('krawings.task.template.line', [lineId]);
}

// ── Spawning ──────────────────────────────────

export async function spawnTodayLists(): Promise<void> {
  await getOdoo().call('krawings.task.template', '_cron_spawn_daily_task_lists', []);
}

// ── Departments (for template manager UI) ────

export interface DepartmentOption {
  id: number;
  name: string;
  company_id: number;
  company_name: string;
}

export async function listDepartments(allowedCompanyIds: number[]): Promise<DepartmentOption[]> {
  const domain: any[] = [];
  if (allowedCompanyIds?.length) domain.push(['company_id', 'in', allowedCompanyIds]);
  const rows = await getOdoo().searchRead(
    'hr.department', domain,
    ['id', 'name', 'company_id'],
    { limit: 200, order: 'company_id, name' },
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    company_id: m2oId(r.company_id)!,
    company_name: m2oName(r.company_id) || '',
  }));
}

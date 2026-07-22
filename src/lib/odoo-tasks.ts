/**
 * odoo-tasks.ts
 * Data layer for the Department Task Manager.
 *
 * Backed by the `krawings_task_manager` Odoo addon (krawings.task.list,
 * krawings.task.template, etc.). No planning.slot dependency — task lists
 * are owned by hr.department and spawned daily by Odoo cron.
 */

import { berlinToday } from './berlin-date';
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
  /** Setup-guide pin position, fraction of the reference image (0–1). 0/0 when not a pin. */
  pin_x: number;
  pin_y: number;
  /** Sequence of the setup photo the pin sits on (multi-photo guides). */
  pin_photo_seq: number;
}

export interface TaskAttachment {
  id: number;
  name: string;
  mimetype: string;
  file_size: number;
  /** 'template' = inherited from the source template line; 'task' = attached directly. */
  scope?: 'template' | 'task';
}

export interface TaskListLine {
  id: number;
  name: string;
  sequence: number;
  day_part: DayPart;
  deadline_datetime: string | null;
  photo_required: boolean;
  photo_uploaded: boolean;
  photo_instructions: string | null;
  module_link_type: ModuleLink;
  state: LineState;
  completed_at: string | null;
  completed_by_id: number | null;
  completed_by_name: string | null;
  is_ad_hoc: boolean;
  source_template_line_id: number | null;
  subtasks: TaskSubtask[];
  attachments: TaskAttachment[];
  note: string | null;
  note_at: string | null;
  note_by_id: number | null;
  note_by_name: string | null;
  /** Setup-guide: this daily line is a visual station-setup guide. */
  is_setup_guide: boolean;
  /** Whether this line carries at least one snapshot reference photo (no binary fetched). */
  has_setup_photo: boolean;
  /** Sequences of this line's setup photos, display order (multi-photo guides). */
  setup_photo_seqs: number[];
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

export type RecurrenceType = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceEndType = 'never' | 'on_date' | 'after_count';
export type MonthlyMode = 'day_of_month' | 'weekday_of_month';

/** Mirror of krawings.task.template.line recurrence_* fields. Mon=0..Sun=6. */
export interface RecurrenceRule {
  type: RecurrenceType;
  interval: number;                // ≥ 1
  start_date: string;              // YYYY-MM-DD
  end_type: RecurrenceEndType;
  end_date: string | null;
  count: number | null;
  one_off_date: string | null;     // type=once
  weekdays: number[];              // type=weekly, e.g. [0,2,4]
  monthly_mode: MonthlyMode;       // monthly + yearly
  day_of_month: number;            // 1..31 or -1 for last day
  weekday_pos: number;             // 1/2/3/4/-1
  weekday: number;                 // 0..6
  month: number;                   // 1..12 (yearly only)
  exception_dates: string[];       // YYYY-MM-DD list
}

export interface TaskTemplateLine {
  id: number;
  name: string;
  sequence: number;
  day_part: DayPart;
  deadline_time: number | null;   // Float hours, e.g. 14.5 = 14:30
  photo_required: boolean;
  photo_instructions: string | null;
  module_link_type: ModuleLink;
  subtasks: TemplatePin[];
  attachments: TaskAttachment[];
  recurrence: RecurrenceRule;
  /** Setup-guide flag + whether at least one reference photo is present (no binary). */
  is_setup_guide: boolean;
  has_setup_photo: boolean;
  /** Sequences of this line's setup photos, display order (multi-photo guides). */
  setup_photo_seqs: number[];
}

/** A template subtask. On a setup-guide line it doubles as a pin (pin_x/pin_y in 0–1, optional catalog item). */
export interface TemplatePin {
  id: number;
  name: string;
  sequence: number;
  pin_x: number;
  pin_y: number;
  /** Sequence of the setup photo the pin sits on (multi-photo guides). */
  pin_photo_seq: number;
  item_id: number | null;
  item_name: string | null;
}

export interface TaskTemplate {
  id: number;
  name: string;
  active: boolean;
  department_id: number;
  department_name: string;
  company_id: number;
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
  line_count: number;
}

export function defaultRecurrence(): RecurrenceRule {
  const today = new Date().toISOString().slice(0, 10);
  return {
    type: 'daily',
    interval: 1,
    start_date: today,
    end_type: 'never',
    end_date: null,
    count: null,
    one_off_date: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    monthly_mode: 'day_of_month',
    day_of_month: 1,
    weekday_pos: 1,
    weekday: 0,
    month: 1,
    exception_dates: [],
  };
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
  // Berlin, not UTC: toISOString() points at YESTERDAY between 00:00–02:00
  // Berlin (summer) — /api/tasks/today would serve the read-only past list.
  return berlinToday();
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
  // Use the addon's sudo'd helper so this works regardless of whether the
  // backend Odoo user has permission to read arbitrary hr.employee records.
  const result = await getOdoo().call(
    'krawings.task.list', 'get_employee_context', [employeeId],
  );
  if (!result) return null;
  return {
    employee_id: result.employee_id,
    employee_name: result.employee_name,
    department_id: result.department_id || null,
    department_name: result.department_name || null,
    company_id: result.company_id || null,
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
  'photo_required', 'photo_uploaded', 'photo_instructions',
  'module_link_type', 'state',
  'completed_at', 'completed_by_id', 'completed_by_name',
  'is_ad_hoc', 'source_template_line_id', 'subtask_ids',
  'note', 'note_at', 'note_by_id', 'note_by_name',
  // Setup guide: filename only (never the binary — served via its own route).
  'is_setup_guide', 'setup_photo_filename',
];

const SUBTASK_FIELDS = [
  'id', 'line_id', 'name', 'sequence', 'done', 'toggled_at', 'toggled_by_id',
  'pin_x', 'pin_y', 'pin_photo_seq',
];

/** Batch-fetch setup-photo sequences for lines (never the image binary).
 * `parentField` is 'list_line_id' or 'template_line_id'. */
async function fetchPhotoSeqsByLine(parentField: string, lineIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (!lineIds.length) return map;
  const rows = await getOdoo().searchRead(
    'krawings.task.setup.photo',
    [[parentField, 'in', lineIds]],
    ['id', parentField, 'sequence'],
    { limit: 1000, order: 'sequence asc' },
  );
  for (const r of rows) {
    const lid = m2oId(r[parentField])!;
    const arr = map.get(lid) || [];
    arr.push(r.sequence ?? 0);
    map.set(lid, arr);
  }
  return map;
}

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
      // Preserve coordinate 0 (a valid edge pin) — don't use `|| 0` on a number.
      pin_x: typeof s.pin_x === 'number' ? s.pin_x : 0,
      pin_y: typeof s.pin_y === 'number' ? s.pin_y : 0,
      pin_photo_seq: typeof s.pin_photo_seq === 'number' ? s.pin_photo_seq : 0,
    });
    subtasksByLine.set(lid, arr);
  }
  Array.from(subtasksByLine.values()).forEach(arr => arr.sort((a, b) => a.sequence - b.sequence));

  // Setup-guide photos: sequences only, batched (bytes come via their own route).
  const photoSeqsByLine = await fetchPhotoSeqsByLine('list_line_id', lineIds);

  // Fetch attachments for all list lines in one batch (combines own + inherited from template).
  const attRaw: any[] = lineIds.length
    ? await odoo.call('krawings.task.list.line', 'list_attachments', [lineIds])
    : [];
  const attsByLine = new Map<number, TaskAttachment[]>();
  for (const a of attRaw) {
    const arr = attsByLine.get(a.line_id) || [];
    arr.push({ id: a.id, name: a.name, mimetype: a.mimetype || '', file_size: a.file_size || 0, scope: a.scope });
    attsByLine.set(a.line_id, arr);
  }

  const hydratedLines: TaskListLine[] = lines.map((l: any) => ({
    id: l.id,
    name: l.name,
    sequence: l.sequence,
    day_part: l.day_part,
    deadline_datetime: odooDtToIso(l.deadline_datetime),
    photo_required: !!l.photo_required,
    photo_uploaded: !!l.photo_uploaded,
    photo_instructions: l.photo_instructions || null,
    module_link_type: (l.module_link_type || 'none') as ModuleLink,
    state: l.state as LineState,
    completed_at: odooDtToIso(l.completed_at),
    completed_by_id: m2oId(l.completed_by_id),
    completed_by_name: l.completed_by_name || null,
    is_ad_hoc: !!l.is_ad_hoc,
    source_template_line_id: m2oId(l.source_template_line_id),
    subtasks: subtasksByLine.get(l.id) || [],
    attachments: attsByLine.get(l.id) || [],
    note: l.note || null,
    note_at: odooDtToIso(l.note_at),
    note_by_id: m2oId(l.note_by_id),
    note_by_name: l.note_by_name || null,
    is_setup_guide: !!l.is_setup_guide,
    // Photo rows are canonical; the legacy filename covers un-migrated lines.
    setup_photo_seqs: photoSeqsByLine.get(l.id) || (l.setup_photo_filename ? [0] : []),
    has_setup_photo: (photoSeqsByLine.get(l.id) || []).length > 0 || !!l.setup_photo_filename,
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

export async function setLineNote(lineId: number, note: string, employeeId: number): Promise<void> {
  await getOdoo().call('krawings.task.list.line', 'set_note', [[lineId], note, employeeId]);
}

/** Lightweight read for push payloads: line name + parent list's date / department. */
export async function getLineSummary(lineId: number): Promise<{ line_name: string; list_id: number; department_id: number; date: string } | null> {
  const rows = await getOdoo().searchRead(
    'krawings.task.list.line',
    [['id', '=', lineId]],
    ['name', 'list_id'],
    { limit: 1 },
  );
  if (!rows.length) return null;
  const listId = m2oId(rows[0].list_id);
  if (!listId) return null;
  const lists = await getOdoo().searchRead(
    'krawings.task.list', [['id', '=', listId]], ['department_id', 'date'], { limit: 1 },
  );
  if (!lists.length) return null;
  return {
    line_name: rows[0].name,
    list_id: listId,
    department_id: m2oId(lists[0].department_id) ?? 0,
    date: lists[0].date,
  };
}

export interface SubtaskToggleResult {
  /** Whether the parent line is a setup guide (pin-driven completion). */
  is_setup_guide: boolean;
  /** Whether the parent line is now completed (guides auto-complete when all pins are done). */
  line_completed: boolean;
}

export async function toggleSubtask(
  lineId: number,
  subtaskId: number,
  done: boolean,
  employeeId: number,
  allowedCompanyIds: number[] = [],
): Promise<SubtaskToggleResult> {
  // Goes through the addon's validated entry point: it checks the subtask belongs
  // to `lineId`, the line's company is allowed, and the day is not read-only —
  // server-side, inside the mutation transaction (closes the toggle IDOR).
  const res = await getOdoo().call(
    'krawings.task.list.line', 'portal_toggle_subtask',
    [lineId, subtaskId, done, employeeId, allowedCompanyIds],
  );
  return {
    is_setup_guide: !!(res && res.is_setup_guide),
    line_completed: !!(res && res.line_completed),
  };
}

export async function addAdHocLine(
  listId: number,
  vals: { name: string; day_part: DayPart; deadline_datetime?: string | null; photo_required?: boolean; photo_instructions?: string | null; module_link_type?: ModuleLink },
): Promise<number> {
  const odooVals: any = {
    name: vals.name,
    day_part: vals.day_part,
    photo_required: !!vals.photo_required,
    photo_instructions: vals.photo_instructions || false,
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
  vals: Partial<{ name: string; day_part: DayPart; deadline_datetime: string | null; photo_required: boolean; photo_instructions: string | null; module_link_type: ModuleLink }>,
): Promise<void> {
  const odooVals: any = { ...vals };
  if (vals.photo_instructions === null) odooVals.photo_instructions = false;
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

/** Re-drive setup-guide completion after a proof photo is added/removed. No-op
 * for non-guide lines. Best-effort so a resync hiccup never fails the upload — a
 * rare failure leaves the (photo-required) guide pending until the next pin
 * toggle re-syncs it; the caller may surface the thrown error if it wants. */
export async function resyncSetupGuide(lineId: number, employeeId: number): Promise<void> {
  await getOdoo().call('krawings.task.list.line', 'resync_setup_guide', [[lineId], employeeId]);
}

// ── Templates ─────────────────────────────────

const TEMPLATE_FIELDS = [
  'id', 'name', 'active', 'department_id', 'company_id',
  'line_count', 'line_ids',
];

const TEMPLATE_LINE_FIELDS = [
  'id', 'template_id', 'name', 'sequence', 'day_part', 'deadline_time',
  'photo_required', 'photo_instructions', 'module_link_type', 'subtask_ids',
  'recurrence_type', 'recurrence_interval', 'recurrence_start_date',
  'recurrence_end_type', 'recurrence_end_date', 'recurrence_count',
  'recurrence_one_off_date', 'recurrence_weekdays', 'recurrence_monthly_mode',
  'recurrence_day_of_month', 'recurrence_weekday_pos', 'recurrence_weekday',
  'recurrence_month', 'exception_ids',
  // Setup guide: filename only (never the binary).
  'is_setup_guide', 'setup_photo_filename',
];

const TEMPLATE_SUBTASK_FIELDS = ['id', 'line_id', 'name', 'sequence', 'pin_x', 'pin_y', 'pin_photo_seq', 'item_id'];
const TEMPLATE_EXCEPTION_FIELDS = ['id', 'line_id', 'date', 'note'];

function dateOrNull(v: any): string | null {
  return v && typeof v === 'string' ? v : null;
}

function parseWeekdays(raw: any): number[] {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
    .map(s => parseInt(s, 10))
    .filter(n => !Number.isNaN(n) && n >= 0 && n <= 6);
}

export async function listTemplates(allowedCompanyIds: number[], includeArchived = false): Promise<TaskTemplateSummary[]> {
  const domain: any[] = [];
  if (!includeArchived) domain.push(['active', '=', true]);
  if (allowedCompanyIds?.length) domain.push(['company_id', 'in', allowedCompanyIds]);
  const rows = await getOdoo().searchRead(
    'krawings.task.template', domain,
    ['id', 'name', 'active', 'department_id', 'company_id', 'line_count'],
    { limit: 200, order: 'department_id, name' },
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    active: !!r.active,
    department_id: m2oId(r.department_id)!,
    department_name: m2oName(r.department_id) || '',
    company_id: m2oId(r.company_id)!,
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
  const subByLine = new Map<number, TemplatePin[]>();
  for (const s of subtasks) {
    const lid = m2oId(s.line_id)!;
    const arr = subByLine.get(lid) || [];
    arr.push({
      id: s.id,
      name: s.name,
      sequence: s.sequence,
      // Preserve coordinate 0 (a valid edge pin) — don't use `|| 0` on a number.
      pin_x: typeof s.pin_x === 'number' ? s.pin_x : 0,
      pin_y: typeof s.pin_y === 'number' ? s.pin_y : 0,
      pin_photo_seq: typeof s.pin_photo_seq === 'number' ? s.pin_photo_seq : 0,
      item_id: m2oId(s.item_id),
      item_name: m2oName(s.item_id),
    });
    subByLine.set(lid, arr);
  }
  Array.from(subByLine.values()).forEach(arr => arr.sort((a, b) => a.sequence - b.sequence));

  // Setup-guide photos per template line (sequences only, batched).
  const tplPhotoSeqs = await fetchPhotoSeqsByLine('template_line_id', lines.map((l: any) => l.id));

  // Attachments per template line (single batch call)
  const tplLineIds: number[] = lines.map((l: any) => l.id);
  const tplAtts: any[] = tplLineIds.length
    ? await odoo.call('krawings.task.template.line', 'list_attachments', [tplLineIds])
    : [];
  const tplAttsByLine = new Map<number, TaskAttachment[]>();
  for (const a of tplAtts) {
    const arr = tplAttsByLine.get(a.line_id) || [];
    arr.push({ id: a.id, name: a.name, mimetype: a.mimetype || '', file_size: a.file_size || 0 });
    tplAttsByLine.set(a.line_id, arr);
  }

  // Exception dates per template line (single batch call)
  const allExceptionIds = lines.flatMap((l: any) => l.exception_ids || []);
  const exceptionRows = allExceptionIds.length
    ? await odoo.searchRead(
        'krawings.task.template.line.exception',
        [['id', 'in', allExceptionIds]], TEMPLATE_EXCEPTION_FIELDS, { limit: 1000 },
      )
    : [];
  const excByLine = new Map<number, string[]>();
  for (const e of exceptionRows) {
    const lid = m2oId(e.line_id)!;
    const arr = excByLine.get(lid) || [];
    if (e.date) arr.push(e.date);
    excByLine.set(lid, arr);
  }
  Array.from(excByLine.values()).forEach(arr => arr.sort());

  const order: Record<DayPart, number> = { opening: 1, mid_day: 2, closing: 3 };
  const hydratedLines: TaskTemplateLine[] = lines.map((l: any) => ({
    id: l.id,
    name: l.name,
    sequence: l.sequence,
    day_part: l.day_part as DayPart,
    // Odoo Float can't be null — a cleared deadline stores 0.0. Treat any falsy value as "no deadline".
    deadline_time: l.deadline_time ? l.deadline_time : null,
    photo_required: !!l.photo_required,
    photo_instructions: l.photo_instructions || null,
    module_link_type: (l.module_link_type || 'none') as ModuleLink,
    subtasks: subByLine.get(l.id) || [],
    attachments: tplAttsByLine.get(l.id) || [],
    is_setup_guide: !!l.is_setup_guide,
    setup_photo_seqs: tplPhotoSeqs.get(l.id) || (l.setup_photo_filename ? [0] : []),
    has_setup_photo: (tplPhotoSeqs.get(l.id) || []).length > 0 || !!l.setup_photo_filename,
    recurrence: {
      type: (l.recurrence_type || 'daily') as RecurrenceType,
      interval: l.recurrence_interval || 1,
      start_date: dateOrNull(l.recurrence_start_date) || new Date().toISOString().slice(0, 10),
      end_type: (l.recurrence_end_type || 'never') as RecurrenceEndType,
      end_date: dateOrNull(l.recurrence_end_date),
      count: l.recurrence_count || null,
      one_off_date: dateOrNull(l.recurrence_one_off_date),
      weekdays: parseWeekdays(l.recurrence_weekdays),
      monthly_mode: (l.recurrence_monthly_mode || 'day_of_month') as MonthlyMode,
      day_of_month: l.recurrence_day_of_month || 1,
      weekday_pos: l.recurrence_weekday_pos || 1,
      weekday: l.recurrence_weekday ?? 0,
      month: l.recurrence_month || 1,
      exception_dates: excByLine.get(l.id) || [],
    },
  }));
  hydratedLines.sort((a, b) => order[a.day_part] - order[b.day_part] || a.sequence - b.sequence);

  return {
    id: r.id,
    name: r.name,
    active: !!r.active,
    department_id: m2oId(r.department_id)!,
    department_name: m2oName(r.department_id) || '',
    company_id: m2oId(r.company_id)!,
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
  photo_instructions?: string | null;
  module_link_type?: ModuleLink;
  subtasks?: { id?: number; name: string; sequence?: number; pin_x?: number; pin_y?: number; pin_photo_seq?: number; item_id?: number | null }[];
  recurrence?: RecurrenceRule;
  is_setup_guide?: boolean;
}

export interface TemplateInput {
  name: string;
  department_id: number;
  active?: boolean;
}

export async function createTemplate(input: TemplateInput): Promise<number> {
  return getOdoo().create('krawings.task.template', {
    name: input.name,
    department_id: input.department_id,
    active: input.active !== false,
  });
}

export async function updateTemplate(id: number, input: Partial<TemplateInput>): Promise<void> {
  const vals: any = {};
  if (input.name !== undefined) vals.name = input.name;
  if (input.department_id !== undefined) vals.department_id = input.department_id;
  if (input.active !== undefined) vals.active = input.active;
  await getOdoo().write('krawings.task.template', [id], vals);
}

export async function archiveTemplate(id: number): Promise<void> {
  await getOdoo().write('krawings.task.template', [id], { active: false });
}

export async function unarchiveTemplate(id: number): Promise<void> {
  await getOdoo().write('krawings.task.template', [id], { active: true });
}

function recurrenceVals(r: RecurrenceRule): Record<string, any> {
  return {
    recurrence_type: r.type,
    recurrence_interval: r.interval || 1,
    recurrence_start_date: r.start_date,
    recurrence_end_type: r.end_type,
    recurrence_end_date: r.end_type === 'on_date' ? (r.end_date || false) : false,
    recurrence_count: r.end_type === 'after_count' ? (r.count || 0) : false,
    recurrence_one_off_date: r.type === 'once' ? (r.one_off_date || false) : false,
    recurrence_weekdays: (r.weekdays || []).join(','),
    recurrence_monthly_mode: r.monthly_mode || 'day_of_month',
    recurrence_day_of_month: r.day_of_month || 1,
    recurrence_weekday_pos: r.weekday_pos || 1,
    recurrence_weekday: r.weekday ?? 0,
    recurrence_month: r.month || 1,
  };
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
    photo_instructions: line.photo_instructions || false,
    module_link_type: line.module_link_type || 'none',
  };
  if (line.is_setup_guide !== undefined) vals.is_setup_guide = !!line.is_setup_guide;
  if (line.recurrence) Object.assign(vals, recurrenceVals(line.recurrence));
  let lineId = line.id;
  if (lineId) {
    await odoo.write('krawings.task.template.line', [lineId], vals);
  } else {
    lineId = await odoo.create('krawings.task.template.line', vals);
  }
  if (line.subtasks) {
    const existing = await odoo.searchRead(
      'krawings.task.template.subtask',
      [['line_id', '=', lineId]], ['id'], { limit: 200 },
    );
    const keepIds = new Set(line.subtasks.filter(s => s.id).map(s => s.id));
    const toDelete = existing.filter((e: any) => !keepIds.has(e.id)).map((e: any) => e.id);
    if (toDelete.length) await odoo.unlink('krawings.task.template.subtask', toDelete);
    for (const s of line.subtasks) {
      const sVals: any = { line_id: lineId, name: s.name, sequence: s.sequence ?? 10 };
      // Pins: carry coordinates + photo link + optional catalog link (setup guides).
      if (s.pin_x !== undefined) sVals.pin_x = s.pin_x;
      if (s.pin_y !== undefined) sVals.pin_y = s.pin_y;
      if (s.pin_photo_seq !== undefined) sVals.pin_photo_seq = s.pin_photo_seq;
      if (s.item_id !== undefined) sVals.item_id = s.item_id || false;
      if (s.id) await odoo.write('krawings.task.template.subtask', [s.id], sVals);
      else await odoo.create('krawings.task.template.subtask', sVals);
    }
  }
  // Replace exception_dates: delete all existing rows, recreate from input.
  // Simple and correct — no need to diff because there's no per-row metadata.
  if (line.recurrence) {
    const existingExc = await odoo.searchRead(
      'krawings.task.template.line.exception',
      [['line_id', '=', lineId]], ['id'], { limit: 500 },
    );
    if (existingExc.length) {
      await odoo.unlink('krawings.task.template.line.exception', existingExc.map((e: any) => e.id));
    }
    for (const date of line.recurrence.exception_dates || []) {
      await odoo.create('krawings.task.template.line.exception', { line_id: lineId, date });
    }
  }
  return lineId;
}

export async function deleteTemplateLine(lineId: number): Promise<void> {
  await getOdoo().unlink('krawings.task.template.line', [lineId]);
}

// ── Attachments ──────────────────────────────

export async function addTemplateLineAttachment(lineId: number, name: string, dataBase64: string, mimetype = ''): Promise<number> {
  return getOdoo().call('krawings.task.template.line', 'add_attachment', [[lineId], name, dataBase64, mimetype || false]);
}

export async function addListLineAttachment(lineId: number, name: string, dataBase64: string, mimetype = ''): Promise<number> {
  return getOdoo().call('krawings.task.list.line', 'add_attachment', [[lineId], name, dataBase64, mimetype || false]);
}

export async function getAttachmentData(attachmentId: number): Promise<{ name: string; mimetype: string; data_base64: string } | null> {
  const result = await getOdoo().call('krawings.task.list.line', 'get_attachment_data', [attachmentId]);
  if (!result) return null;
  return result;
}

export async function deleteAttachment(attachmentId: number): Promise<void> {
  await getOdoo().unlink('ir.attachment', [attachmentId]);
}

// ── Spawning ──────────────────────────────────

export async function spawnTodayLists(): Promise<void> {
  await getOdoo().call('krawings.task.template', 'spawn_today_lists', []);
}

export async function ensureListForDeptDate(departmentId: number, date: string): Promise<number> {
  return getOdoo().call('krawings.task.list', 'ensure_for_dept_date', [departmentId, date]);
}

// ── Departments (for template manager UI) ────

export interface DepartmentOption {
  id: number;
  name: string;
  company_id: number;
  company_name: string;
}

/** Whether a template line belongs to the given template — a cheap IDOR guard for line routes. */
export async function templateLineBelongsToTemplate(templateId: number, lineId: number): Promise<boolean> {
  if (!templateId || !lineId) return false;
  const rows = await getOdoo().searchRead(
    'krawings.task.template.line', [['id', '=', lineId]], ['template_id'], { limit: 1 },
  );
  if (!rows.length) return false;
  return m2oId(rows[0].template_id) === templateId;
}

/** Persisted guide flag + current pin count of a template line — lets a PATCH
 * that omits is_setup_guide and/or subtasks compute the EFFECTIVE post-write
 * state (so it can't enable an empty guide or silently empty an existing one). */
export async function getTemplateLineGuideMeta(lineId: number): Promise<{ isGuide: boolean; pinCount: number }> {
  if (!lineId) return { isGuide: false, pinCount: 0 };
  const rows = await getOdoo().searchRead(
    'krawings.task.template.line', [['id', '=', lineId]], ['is_setup_guide', 'subtask_ids'], { limit: 1 },
  );
  if (!rows.length) return { isGuide: false, pinCount: 0 };
  return { isGuide: !!rows[0].is_setup_guide, pinCount: (rows[0].subtask_ids || []).length };
}

/** The company + date of the daily list a line belongs to — used to company-scope
 * and past-list-guard line-level routes (e.g. proof-photo upload). */
export async function getListLineScope(lineId: number): Promise<{ companyId: number | null; date: string | null } | null> {
  if (!lineId) return null;
  const rows = await getOdoo().searchRead(
    'krawings.task.list.line', [['id', '=', lineId]], ['list_id'], { limit: 1 },
  );
  if (!rows.length) return null;
  const listId = m2oId(rows[0].list_id);
  if (!listId) return { companyId: null, date: null };
  const lists = await getOdoo().searchRead(
    'krawings.task.list', [['id', '=', listId]], ['company_id', 'date'], { limit: 1 },
  );
  if (!lists.length) return { companyId: null, date: null };
  return { companyId: m2oId(lists[0].company_id), date: lists[0].date || null };
}

/** Company that owns a template, or null if not found. Used to company-scope template routes. */
export async function getTemplateCompany(templateId: number): Promise<number | null> {
  if (!templateId) return null;
  const rows = await getOdoo().searchRead(
    'krawings.task.template', [['id', '=', templateId]], ['company_id'], { limit: 1 },
  );
  if (!rows.length) return null;
  return m2oId(rows[0].company_id);
}

/** Company that owns a department, or null if not found. Used to company-scope routes. */
export async function getDepartmentCompany(departmentId: number): Promise<number | null> {
  if (!departmentId) return null;
  const rows = await getOdoo().searchRead(
    'hr.department', [['id', '=', departmentId]], ['company_id'], { limit: 1 },
  );
  if (!rows.length) return null;
  return m2oId(rows[0].company_id);
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

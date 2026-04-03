/**
 * odoo-tasks.ts
 * Data layer for the Task Management module.
 *
 * Shifts:     read from planning.slot (real Odoo data — confirmed working)
 * Task lists: stubs until restaurant_shift_tasks Odoo module is installed
 *
 * Every stub function has a TODO comment showing the exact RPC call to swap in.
 */

import { getOdoo } from './odoo';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SubTask {
  id: number;
  name: string;
  done: boolean;
}

export interface TaskLine {
  id: number;
  name: string;
  sequence: number;
  state: 'pending' | 'done' | 'overdue';
  deadline_datetime: string | null;   // ISO UTC
  photo_required: boolean;
  photo_uploaded: boolean;
  subtasks: SubTask[];
  all_subtasks_done: boolean;
  module_link_type: '' | 'inventory' | 'purchase' | 'pos' | 'manufacturing';
  module_link_label: string;
  completed_at: string | null;
  completed_by_name: string | null;
}

export interface ShiftTaskList {
  id: number;
  name: string;
  shift_name: string;
  shift_start: string;
  shift_end: string;
  template_name: string;
  state: 'draft' | 'in_progress' | 'done';
  completion_rate: number;
  staff_names: string[];
  task_lines: TaskLine[];
}

export interface Shift {
  id: number;                   // planning.slot id
  name: string;                 // derived from role_id name
  start: string;                // ISO UTC
  end: string;                  // ISO UTC
  state: 'active' | 'upcoming' | 'done';
  task_list_id: number | null;  // restaurant.shift.task.list id (null until module installed)
  completion_rate: number;
  overdue_count: number;
  role: string;                 // e.g. "D2 (GBM)"
  employee_id: number;
  employee_name: string;
}

export interface ManagerDashboard {
  active_shifts: number;
  avg_completion: number;
  overdue_count: number;
  photos_pending: number;
  shifts: Shift[];
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Returns today's date range in UTC as ISO strings */
function todayUTCRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Derives shift state from start/end times */
function shiftState(start: string, end: string): 'active' | 'upcoming' | 'done' {
  const now = Date.now();
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (now >= s && now <= e) return 'active';
  if (now < s) return 'upcoming';
  return 'done';
}

/** Converts planning.slot Odoo record → our Shift type */
function slotToShift(slot: any): Shift {
  const roleName = Array.isArray(slot.role_id) ? slot.role_id[1] : (slot.role_id || 'Shift');
  const empId    = Array.isArray(slot.employee_id) ? slot.employee_id[0] : slot.employee_id;
  const empName  = Array.isArray(slot.employee_id) ? slot.employee_id[1] : 'Unknown';

  // Odoo stores datetimes as UTC strings like "2026-04-04 10:30:00"
  // Convert to ISO format for consistency
  const startISO = slot.start_datetime
    ? new Date(slot.start_datetime.replace(' ', 'T') + 'Z').toISOString()
    : new Date().toISOString();
  const endISO = slot.end_datetime
    ? new Date(slot.end_datetime.replace(' ', 'T') + 'Z').toISOString()
    : new Date().toISOString();

  return {
    id:              slot.id,
    name:            roleName,
    start:           startISO,
    end:             endISO,
    state:           shiftState(startISO, endISO),
    task_list_id:    null,      // TODO: read from restaurant.shift.task.list once module installed
    completion_rate: 0,         // TODO: read from task list
    overdue_count:   0,         // TODO: read from task list
    role:            roleName,
    employee_id:     empId,
    employee_name:   empName,
  };
}

// ─────────────────────────────────────────────
// Stub task list (used until Odoo module exists)
// ─────────────────────────────────────────────

function stubTaskList(shift: Shift): ShiftTaskList {
  return {
    id: shift.id,
    name: `${shift.name} — Task List`,
    shift_name: shift.name,
    shift_start: shift.start,
    shift_end: shift.end,
    template_name: 'Opening Checklist v3',
    state: 'in_progress',
    completion_rate: 57,
    staff_names: [shift.employee_name],
    task_lines: [
      {
        id: 101, name: 'Review and place morning purchase order', sequence: 1,
        state: 'pending',
        deadline_datetime: new Date(new Date(shift.start).getTime() + 90 * 60000).toISOString(),
        photo_required: false, photo_uploaded: false,
        subtasks: [], all_subtasks_done: true,
        module_link_type: 'purchase', module_link_label: 'Open Purchase Orders',
        completed_at: null, completed_by_name: null,
      },
      {
        id: 102, name: 'Inspect restrooms', sequence: 2,
        state: 'overdue',
        deadline_datetime: new Date(new Date(shift.start).getTime() + 60 * 60000).toISOString(),
        photo_required: true, photo_uploaded: false,
        subtasks: [
          { id: 201, name: 'Check paper supplies',      done: false },
          { id: 202, name: 'Wipe mirrors and surfaces', done: false },
          { id: 203, name: 'Mop floor',                 done: false },
        ],
        all_subtasks_done: false,
        module_link_type: '', module_link_label: '',
        completed_at: null, completed_by_name: null,
      },
      {
        id: 103, name: 'Do morning stock count', sequence: 3,
        state: 'pending',
        deadline_datetime: new Date(new Date(shift.start).getTime() + 120 * 60000).toISOString(),
        photo_required: true, photo_uploaded: false,
        subtasks: [], all_subtasks_done: true,
        module_link_type: 'inventory', module_link_label: 'Open Inventory · Stock Count',
        completed_at: null, completed_by_name: null,
      },
      {
        id: 104, name: 'Check walk-in cooler temperature', sequence: 4,
        state: 'done',
        deadline_datetime: new Date(new Date(shift.start).getTime() + 30 * 60000).toISOString(),
        photo_required: true, photo_uploaded: true,
        subtasks: [], all_subtasks_done: true,
        module_link_type: '', module_link_label: '',
        completed_at: new Date(new Date(shift.start).getTime() + 18 * 60000).toISOString(),
        completed_by_name: shift.employee_name,
      },
      {
        id: 105, name: 'Count cash register float', sequence: 5,
        state: 'done',
        deadline_datetime: null,
        photo_required: true, photo_uploaded: true,
        subtasks: [], all_subtasks_done: true,
        module_link_type: '', module_link_label: '',
        completed_at: new Date(new Date(shift.start).getTime() + 55 * 60000).toISOString(),
        completed_by_name: shift.employee_name,
      },
    ],
  };
}

// ─────────────────────────────────────────────
// Public API — Shifts (REAL Odoo data)
// ─────────────────────────────────────────────

/**
 * Get today's shifts for a specific employee.
 * Queries planning.slot filtered by employee_id and today's date range.
 */
export async function getMyShifts(employeeId: number): Promise<Shift[]> {
  if (!employeeId) return [];

  const { start, end } = todayUTCRange();

  // Convert ISO to Odoo datetime format "YYYY-MM-DD HH:MM:SS"
  const odooStart = start.replace('T', ' ').substring(0, 19);
  const odooEnd   = end.replace('T', ' ').substring(0, 19);

  const slots = await getOdoo().searchRead(
    'planning.slot',
    [
      ['employee_id', '=', employeeId],
      ['start_datetime', '>=', odooStart],
      ['start_datetime', '<=', odooEnd],
    ],
    ['id', 'name', 'employee_id', 'start_datetime', 'end_datetime', 'role_id'],
    { order: 'start_datetime asc' },
  );

  return slots.map(slotToShift);
}

/**
 * Get all shifts today (manager view).
 */
export async function getAllShiftsToday(): Promise<Shift[]> {
  const { start, end } = todayUTCRange();
  const odooStart = start.replace('T', ' ').substring(0, 19);
  const odooEnd   = end.replace('T', ' ').substring(0, 19);

  const slots = await getOdoo().searchRead(
    'planning.slot',
    [
      ['start_datetime', '>=', odooStart],
      ['start_datetime', '<=', odooEnd],
    ],
    ['id', 'name', 'employee_id', 'start_datetime', 'end_datetime', 'role_id'],
    { order: 'start_datetime asc' },
  );

  return slots.map(slotToShift);
}

// ─────────────────────────────────────────────
// Public API — Task Lists (STUBS)
// Replace these once restaurant_shift_tasks is installed
// ─────────────────────────────────────────────

/**
 * Get task list for a shift.
 * TODO: replace with real query:
 *   getOdoo().searchRead('restaurant.shift.task.list',
 *     [['planning_slot_id','=',shiftId]], ...)
 */
export async function getTaskListForShift(shift: Shift): Promise<ShiftTaskList | null> {
  if (shift.task_list_id) {
    // TODO: real fetch from restaurant.shift.task.list
    return stubTaskList(shift);
  }
  // No task list assigned yet — return stub for active shifts
  if (shift.state === 'active') {
    return stubTaskList(shift);
  }
  return null;
}

/**
 * Complete a task line.
 * TODO: getOdoo().call('restaurant.task.line', 'action_complete', [[taskLineId]])
 */
export async function completeTask(
  taskLineId: number,
): Promise<{ ok: boolean; error?: string }> {
  console.log('[stub] completeTask', taskLineId);
  return { ok: true };
}

/**
 * Toggle a subtask done/undone.
 * TODO: getOdoo().write('restaurant.task.line', [subtaskId], { done })
 */
export async function toggleSubtask(
  _taskLineId: number,
  subtaskId: number,
  done: boolean,
): Promise<void> {
  console.log('[stub] toggleSubtask', subtaskId, done);
}

/**
 * Upload a photo for a task.
 * TODO: POST binary to /web/binary/upload_attachment with task line reference
 */
export async function uploadTaskPhoto(
  _taskLineId: number,
  _file: File,
): Promise<{ attachment_id: number }> {
  return { attachment_id: 9999 };
}

// ─────────────────────────────────────────────
// Manager dashboard
// ─────────────────────────────────────────────

export async function getManagerDashboard(): Promise<ManagerDashboard> {
  const shifts = await getAllShiftsToday();
  const activeShifts = shifts.filter(s => s.state === 'active');

  return {
    active_shifts:  activeShifts.length,
    avg_completion: 0,   // TODO: compute from task lists
    overdue_count:  0,   // TODO: count from task lines
    photos_pending: 0,   // TODO: count from task completions
    shifts,
  };
}

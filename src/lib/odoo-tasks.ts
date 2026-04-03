/**
 * odoo-tasks.ts
 * Data layer for the Task Management module.
 *
 * Shifts:     read from planning.slot (real Odoo data).
 *             Falls back to STUB shifts when no slots exist for today
 *             (useful for testing before real shifts are planned).
 * Task lists: stubs until restaurant_shift_tasks Odoo module is installed.
 */

import { getOdoo } from './odoo';

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
  deadline_datetime: string | null;
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
  id: number;
  name: string;
  start: string;
  end: string;
  state: 'active' | 'upcoming' | 'done';
  task_list_id: number | null;
  completion_rate: number;
  overdue_count: number;
  role: string;
  employee_id: number;
  employee_name: string;
  is_stub?: boolean; // true when generated as fallback test data
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

function todayUTCRange() {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end   = new Date(now); end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function shiftState(start: string, end: string): 'active' | 'upcoming' | 'done' {
  const now = Date.now();
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (now >= s && now <= e) return 'active';
  if (now < s) return 'upcoming';
  return 'done';
}

function slotToShift(slot: any): Shift {
  const roleName = Array.isArray(slot.role_id) ? slot.role_id[1] : (slot.role_id || 'Shift');
  const empId    = Array.isArray(slot.employee_id) ? slot.employee_id[0] : slot.employee_id;
  const empName  = Array.isArray(slot.employee_id) ? slot.employee_id[1] : 'Unknown';
  const startISO = slot.start_datetime
    ? new Date(slot.start_datetime.replace(' ', 'T') + 'Z').toISOString()
    : new Date().toISOString();
  const endISO = slot.end_datetime
    ? new Date(slot.end_datetime.replace(' ', 'T') + 'Z').toISOString()
    : new Date().toISOString();
  return {
    id: slot.id, name: roleName, start: startISO, end: endISO,
    state: shiftState(startISO, endISO),
    task_list_id: null, completion_rate: 0, overdue_count: 0,
    role: roleName, employee_id: empId, employee_name: empName,
  };
}

// ─────────────────────────────────────────────
// Stub fallback shifts (used when no planning.slot found for today)
// ─────────────────────────────────────────────

function stubShiftsForToday(employeeId: number): Shift[] {
  const now = new Date();
  const todayAt = (h: number, m = 0) => {
    const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString();
  };
  return [
    {
      id: 90001,
      name: 'Morning Opening',
      start: todayAt(7),
      end:   todayAt(11),
      state: shiftState(todayAt(7), todayAt(11)),
      task_list_id: null,
      completion_rate: 57,
      overdue_count: 1,
      role: 'Opening',
      employee_id: employeeId,
      employee_name: 'You',
      is_stub: true,
    },
    {
      id: 90002,
      name: 'Evening Service',
      start: todayAt(17),
      end:   todayAt(23),
      state: shiftState(todayAt(17), todayAt(23)),
      task_list_id: null,
      completion_rate: 0,
      overdue_count: 0,
      role: 'Service',
      employee_id: employeeId,
      employee_name: 'You',
      is_stub: true,
    },
  ];
}

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
      {
        id: 106, name: 'Brief kitchen team on specials', sequence: 6,
        state: 'pending',
        deadline_datetime: new Date(new Date(shift.start).getTime() + 180 * 60000).toISOString(),
        photo_required: false, photo_uploaded: false,
        subtasks: [], all_subtasks_done: true,
        module_link_type: '', module_link_label: '',
        completed_at: null, completed_by_name: null,
      },
    ],
  };
}

// ─────────────────────────────────────────────
// Public API — Shifts
// ─────────────────────────────────────────────

/**
 * Get today's shifts for an employee.
 * Queries planning.slot first. Falls back to stub shifts if none found today.
 */
export async function getMyShifts(employeeId: number): Promise<Shift[]> {
  if (!employeeId) return [];

  const { start, end } = todayUTCRange();
  const odooStart = start.replace('T', ' ').substring(0, 19);
  const odooEnd   = end.replace('T', ' ').substring(0, 19);

  try {
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

    if (slots.length > 0) return slots.map(slotToShift);
  } catch (e) {
    console.warn('[odoo-tasks] planning.slot query failed, using stubs:', e);
  }

  // No real shifts today — return stub data for testing
  console.log('[odoo-tasks] No planning.slot found for today, returning stub shifts');
  return stubShiftsForToday(employeeId);
}

export async function getAllShiftsToday(): Promise<Shift[]> {
  const { start, end } = todayUTCRange();
  const odooStart = start.replace('T', ' ').substring(0, 19);
  const odooEnd   = end.replace('T', ' ').substring(0, 19);
  try {
    const slots = await getOdoo().searchRead(
      'planning.slot',
      [['start_datetime', '>=', odooStart], ['start_datetime', '<=', odooEnd]],
      ['id', 'name', 'employee_id', 'start_datetime', 'end_datetime', 'role_id'],
      { order: 'start_datetime asc' },
    );
    return slots.map(slotToShift);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// Public API — Task Lists (stubs)
// ─────────────────────────────────────────────

export async function getTaskListForShift(shift: Shift): Promise<ShiftTaskList | null> {
  // TODO: query restaurant.shift.task.list once Odoo module is installed
  if (shift.state === 'done') return null;
  return stubTaskList(shift);
}

export async function completeTask(taskLineId: number): Promise<{ ok: boolean; error?: string }> {
  console.log('[stub] completeTask', taskLineId);
  return { ok: true };
}

export async function toggleSubtask(_taskLineId: number, subtaskId: number, done: boolean): Promise<void> {
  console.log('[stub] toggleSubtask', subtaskId, done);
}

export async function uploadTaskPhoto(_taskLineId: number, _file: File): Promise<{ attachment_id: number }> {
  return { attachment_id: 9999 };
}

export async function getManagerDashboard(): Promise<ManagerDashboard> {
  const shifts = await getAllShiftsToday();
  const active = shifts.filter(s => s.state === 'active');
  return { active_shifts: active.length, avg_completion: 0, overdue_count: 0, photos_pending: 0, shifts };
}

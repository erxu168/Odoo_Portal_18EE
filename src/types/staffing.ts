/**
 * Staff Lifecycle Checklists — shared types.
 *
 * Three lifecycle stages (joining/promotion/leaving). Joining & Leaving are built
 * from a shared `base` list + an optional `team` add-on; Promotion is a single
 * `level` list keyed to the target level. Everything is portal-native (SQLite);
 * Odoo is read-only. See docs/superpowers/specs/2026-07-19-staffing-hire-leave-checklists-design.md.
 */
export type Stage = 'joining' | 'promotion' | 'leaving';
export type Scope = 'base' | 'team' | 'level';
export type Audience = 'business' | 'employee';
export type ResponsibleType = 'specific_user' | 'employee_manager' | 'the_employee';
export type TaskStatus = 'pending' | 'done' | 'skipped';
export type InstanceStatus = 'open' | 'done' | 'cancelled';
export type DueState = 'none' | 'upcoming' | 'due_soon' | 'overdue' | 'done';

export interface TemplateRow {
  id: number;
  company_id: number;
  stage: Stage;
  scope: Scope;
  department_id: number | null;   // scope='team'
  target_level: string | null;    // scope='level' (e.g. '2','3')
  name: string;
  active: number;                 // 0|1
  created_at: string;
  updated_at: string;
}

export interface TemplateTaskRow {
  id: number;
  template_id: number;
  audience: Audience;
  title: string;
  description: string | null;
  sequence: number;
  responsible_type: ResponsibleType;
  responsible_user_id: number | null;   // portal user id, when specific_user
  due_offset_days: number | null;
  reminder: number;                      // 0|1
  active: number;
}

export interface InstanceRow {
  id: number;
  employee_id: number;
  company_id: number;
  stage: Stage;
  department_id: number | null;
  department_name: string | null;   // snapshot for history
  target_level: string | null;
  from_level: string | null;
  reference_date: string;           // YYYY-MM-DD
  status: InstanceStatus;
  started_by: number;
  started_at: string;
  termination_id: number | null;
  start_key: string;
}

export interface InstanceTaskRow {
  id: number;
  instance_id: number;
  audience: Audience;
  title: string;
  description: string | null;
  sequence: number;
  source: Scope;
  assignee_user_id: number | null;
  assignee_employee_id: number | null;
  due_date: string | null;          // YYYY-MM-DD
  reminder: number;
  status: TaskStatus;
  done_by: number | null;
  done_at: string | null;
  note: string | null;
  reminder_stage: number;           // 0..3
}

/** A template task flattened for merging into an instance. */
export interface TemplateTaskSeed {
  audience: Audience;
  title: string;
  description: string | null;
  sequence: number;
  responsible_type: ResponsibleType;
  responsible_user_id: number | null;
  due_offset_days: number | null;
  reminder: boolean;
  source: Scope;
}

export interface CreateTemplateInput {
  company_id: number;
  stage: Stage;
  scope: Scope;
  department_id?: number | null;
  target_level?: string | null;
  name: string;
}

export interface UpsertTemplateTaskInput {
  audience: Audience;
  title: string;
  description?: string | null;
  sequence?: number;
  responsible_type: ResponsibleType;
  responsible_user_id?: number | null;
  due_offset_days?: number | null;
  reminder?: boolean;
}

// =============================================================================
// Shifts module — shared types
// Odoo planning.slot is the source of truth for shifts; cover requests,
// sick reports, settings and notifications live in the portal SQLite.
// Import these from '@/types/shifts' in API routes and components.
// =============================================================================

/** A shift as read from Odoo planning.slot (times are Odoo UTC-naive strings). */
export interface ShiftSlot {
  id: number;
  /** "YYYY-MM-DD HH:MM:SS" UTC-naive (Odoo format) */
  start: string;
  /** "YYYY-MM-DD HH:MM:SS" UTC-naive (Odoo format) */
  end: string;
  state: 'draft' | 'published';
  roleId: number | null;
  roleName: string;
  /** resource.resource id — the WRITE target for assignment; null = open shift */
  resourceId: number | null;
  /** hr.employee id (readonly related on planning.slot — reads only) */
  employeeId: number | null;
  employeeName: string;
  /** hr.department id stored on the slot (planning.slot.department_id); null = none */
  departmentId: number | null;
  departmentName: string;
  /** Portal override: min skill to claim ('2'|'3'); set by the manage overlay only. */
  minSkill?: string | null;
  note: string;
  overCap: boolean;
  /** Duration in hours = end − start, computed portal-side. NEVER allocated_hours. */
  hours: number;
  companyId: number;
}

/** An employee eligible for shift work, with caps/skills/roles resolved. */
export interface ShiftEmployee {
  id: number;
  name: string;
  resourceId: number | null;
  departmentId: number | null;
  departmentName: string;
  /** Weekly hour cap from x_max_weekly_hours; null = no cap (0/absent in Odoo) */
  cap: number | null;
  /** skill level: '1' | '2' | '3' (higher = more senior) */
  skill: '1' | '2' | '3' | null;
  /** planning.role ids the employee can work as (resource.resource.role_ids) */
  roleIds: number[];
  /** German classification from hr.employee.x_employment_type; null = unclassified */
  employmentType: 'minijob' | 'midijob' | 'fulltime' | null;
  /** Contracted weekly hours (hr.contract.kw_agreed_weekly_hours); null = none on file */
  weeklyTarget: number | null;
  /** €/h from the current contract; falls back to the statutory minimum wage */
  hourlyRate: number;
  /** false when the employee has no contract on file (rate is the fallback) */
  hasContract: boolean;
}

/** Per-company shift settings (portal SQLite, defaults 1/12/2/1/1). */
export interface ShiftSettings {
  companyId: number;
  requireApproval: boolean;
  answerDeadlineHours: number;
  settleBufferHours: number;
  allowAskAll: boolean;
  allowSickReport: boolean;
  /** Require staff to confirm ("I'll be there") their assigned published shifts. */
  requireConfirmation: boolean;
  /** Hours before a shift by which confirmation is due (drives reminders + overdue). */
  confirmByHours: number;
}

/** Snapshot of the slot at cover-request creation time. */
export interface SlotSnapshot {
  start: string;
  end: string;
  roleId: number | null;
  resourceId: number | null;
}

export type CoverRequestStatus =
  | 'pending_teammate'
  | 'pending_manager'
  | 'approved'
  | 'auto_applied'
  | 'declined_by_teammate'
  | 'declined_by_manager'
  | 'cancelled_by_requester'
  | 'expired'
  | 'invalidated'
  | 'undone';

export interface CoverRequest {
  id: number;
  slotId: number;
  companyId: number;
  fromEmployeeId: number;
  /** null when ask_all */
  toEmployeeId: number | null;
  askAll: boolean;
  /** winner (ask_all) or the direct target on accept */
  acceptedByEmployeeId: number | null;
  message: string | null;
  status: string;
  slotSnapshot: SlotSnapshot;
  /** ISO UTC */
  answerDeadline: string;
  createdAt: string;
  updatedAt: string;
  decidedByEmployeeId: number | null;
  decidedAt: string | null;
}

export interface SickReport {
  id: number;
  slotId: number;
  companyId: number;
  employeeId: number;
  note: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
  resolvedAction: 'reopened' | 'reassigned' | 'kept' | null;
}

export type ShiftNotificationType =
  | 'cover_request_received'
  | 'cover_accepted'
  | 'cover_declined_by_teammate'
  | 'cover_cancelled'
  | 'cover_approved'
  | 'cover_declined'
  | 'cover_auto_applied'
  | 'cover_expired'
  | 'cover_invalidated'
  | 'sick_reported'
  | 'shift_published'
  | 'shift_unpublished';

export interface ShiftNotification {
  id: number;
  employeeId: number;
  companyId: number;
  type: string;
  /** Always includes slot summary {day, time, roleName} + names. */
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** A reusable shift template (name + times + optional role/headcount), per company. */
export interface ShiftTemplate {
  id: number;
  companyId: number;
  name: string;
  startHHMM: string;
  endHHMM: string;
  roleId: number | null;
  headcount: number;
  createdAt: string;
}

// -- Shift patterns (reusable weekly stencils) + publish runs --------------------

/** Lifecycle of a published week of shifts. */
export type PublishRunState = 'open' | 'locked' | 'finalized';

/** One line of a weekly pattern: a shift that repeats on a given weekday. */
export interface ShiftPatternLine {
  /** 1=Mon … 7=Sun (ISO) */
  weekday: number;
  startHHMM: string;
  endHHMM: string;
  roleId: number | null;
  departmentId: number | null;
  /** how many people this shift needs (1..20) */
  headcount: number;
  /** min skill to claim ('2' = Level 2+ | '3' = Level 3 | null = anyone) */
  minSkill: '2' | '3' | null;
}

/** A reusable weekly pattern of shifts, per company. */
export interface ShiftPattern {
  id: number;
  companyId: number;
  name: string;
  active: boolean;
  createdAt: string;
  lines: ShiftPatternLine[];
}

/** One publish of a pattern into a week, with the staff-selection deadline. */
export interface ShiftPublishRun {
  id: number;
  companyId: number;
  patternId: number | null;
  weekKey: string;
  /** ISO datetime by which staff must have chosen */
  selectDeadline: string;
  state: PublishRunState;
  createdAt: string;
}

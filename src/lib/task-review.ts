/**
 * task-review.ts — data layer for the Task Manager photo-review + end-of-day
 * summary. All calls go through getOdoo() (server-side only), backed by the
 * krawings_task_manager addon:
 *   - krawings.task.list.line  portal_review_feed / portal_set_photo_flag /
 *                              get_review_photo / portal_day_summary
 *   - res.company              portal_claim_summary + kw_task_summary_* fields
 *
 * Flagging a photo is OVERSIGHT ONLY — it never changes a task's completion.
 */
import { getOdoo } from '@/lib/odoo';

export interface ReviewPhoto {
  id: number;
  name: string;
  mimetype: string;
}

export interface ReviewItem {
  line_id: number;
  name: string;
  day_part: 'opening' | 'mid_day' | 'closing';
  completed_by_id: number | false;
  completed_by_name: string;
  completed_at: string;
  flagged: boolean;
  flag_reason: string;
  flagged_by_name: string;
  attachments: ReviewPhoto[];
}

export interface ReviewFeed {
  stats: { submitted: number; flagged: number; looks_good: number };
  items: ReviewItem[];
}

export async function readReviewFeed(
  allowedCompanyIds: number[],
  dateStr?: string,
  employeeId?: number,
): Promise<ReviewFeed> {
  const r: unknown = await getOdoo().call('krawings.task.list.line', 'portal_review_feed', [
    allowedCompanyIds, dateStr ?? null, employeeId ?? null,
  ]);
  return (r as ReviewFeed) || { stats: { submitted: 0, flagged: 0, looks_good: 0 }, items: [] };
}

export interface FlagResult {
  line_id: number;
  name: string;
  company_id: number;
  flagged: boolean;
  /** True only on a false→true transition — push the staff redo notice only then. */
  newly_flagged: boolean;
  reason: string;
  completed_by_id: number | false;
}

export async function setPhotoFlag(
  lineId: number,
  flagged: boolean,
  reason: string | null,
  employeeId: number | null,
  allowedCompanyIds: number[],
): Promise<FlagResult> {
  return getOdoo().call('krawings.task.list.line', 'portal_set_photo_flag', [
    lineId, flagged, reason, employeeId, allowedCompanyIds,
  ]);
}

export interface ReviewPhotoBytes {
  filename: string;
  mimetype: string;
  data_base64: string;
}

export async function getReviewPhoto(
  attachmentId: number,
  allowedCompanyIds: number[],
): Promise<ReviewPhotoBytes | null> {
  const r: unknown = await getOdoo().call('krawings.task.list.line', 'get_review_photo', [
    attachmentId, allowedCompanyIds,
  ]);
  return (r as ReviewPhotoBytes) || null;
}

export interface DaySummary {
  company_id: number;
  date: string;
  total: number;
  done: number;
  missed_names: string[];
  photos_to_review: number;
}

export async function getDaySummary(companyId: number, dateStr?: string): Promise<DaySummary> {
  return getOdoo().call('krawings.task.list.line', 'portal_day_summary', [companyId, dateStr ?? null]);
}

/** Atomically claim a company's end-of-day summary for `dateStr` — true once per date. */
export async function claimSummary(companyId: number, dateStr: string): Promise<boolean> {
  const r: unknown = await getOdoo().call('res.company', 'portal_claim_summary', [companyId, dateStr]);
  return r === true;
}

export interface OverdueDeptDigest {
  department_id: number;
  department_name: string;
  names: string[];
}

/** Tasks overdue past the grace period, grouped by department.
 *  CLAIMS as it reads — every task returned is marked alerted, so a retry or a
 *  second run cannot report the same one inside the repeat window. */
export function overdueDigest(
  companyId: number,
  graceMinutes: number,
  repeatMinutes: number,
  dates: string[],
): Promise<OverdueDeptDigest[]> {
  return getOdoo().call('krawings.task.list.line', 'portal_overdue_digest',
    [companyId, graceMinutes, repeatMinutes, dates]);
}

/** The service days that are OPEN right now — normally today, plus yesterday
 *  while a day that ends at midnight is still inside its grace tail. Empty
 *  means quiet hours: say nothing. Replaces the old boolean, because knowing
 *  WHICH day is open is what lets the last tasks of the night be chased at all. */
export function activeServiceDates(
  companyId: number,
  nowFloat: number,
  todayStr: string,
  tailMinutes: number,
): Promise<string[]> {
  return getOdoo().call('krawings.task.service.day', 'active_service_dates',
    [companyId, nowFloat, todayStr, tailMinutes]);
}

// ── Accountability (read only) ──────────────────────────────────────────────

export interface AccountabilityPerson {
  employee_id: number;
  name: string;
  done: number;
  on_time: number;
  late: number;
  /** Completed with no deadline to measure against — most tasks until an owner
   *  sets their service times. Kept separate so "on time" is never inflated. */
  untimed: number;
  flagged: number;
  avg_late_minutes: number;
}

export interface AccountabilityTotals {
  done: number; on_time: number; late: number; untimed: number;
  flagged: number; people: number;
}

export interface AccountabilityRow {
  line_id: number;
  name: string;
  date: string;
  department_name: string;
  day_part: string;
  deadline: string;
  deadline_is_implicit: boolean;
  completed_at: string;
  late_by_minutes: number;
  flagged: boolean;
  flag_reason: string;
}

/** Who completed what over a range. Reports on what people DID — a task nobody
 *  did cannot be attributed, because tasks belong to a department rather than
 *  a person. */
export function accountability(
  companyId: number,
  dateFrom: string,
  dateTo: string,
  departmentId: number | null,
  allowedCompanyIds: number[],
): Promise<{ people: AccountabilityPerson[]; totals: AccountabilityTotals }> {
  return getOdoo().call('krawings.task.list.line', 'portal_accountability',
    [companyId, dateFrom, dateTo, departmentId, allowedCompanyIds]);
}

/** {rows, total} — total is the true match count, so the screen can say when it
 *  is only showing the most recent slice. A silent cap in a report used to
 *  judge people reads as "they did nothing that month". */
export function accountabilityDetail(
  companyId: number,
  employeeId: number,
  dateFrom: string,
  dateTo: string,
  allowedCompanyIds: number[],
): Promise<{ rows: AccountabilityRow[]; total: number }> {
  return getOdoo().call('krawings.task.list.line', 'portal_accountability_detail',
    [companyId, employeeId, dateFrom, dateTo, allowedCompanyIds]);
}

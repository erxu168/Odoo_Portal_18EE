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
): Promise<OverdueDeptDigest[]> {
  return getOdoo().call('krawings.task.list.line', 'portal_overdue_digest',
    [companyId, graceMinutes, repeatMinutes]);
}

/** Is now inside this restaurant's working day? Quiet hours for the alert. */
export function withinServiceHours(
  companyId: number,
  nowFloat: number,
  dateStr: string,
  tailMinutes: number,
): Promise<boolean> {
  return getOdoo().call('krawings.task.service.day', 'is_within_hours',
    [companyId, nowFloat, dateStr, tailMinutes]);
}

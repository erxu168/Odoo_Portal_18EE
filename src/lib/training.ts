/**
 * Training courses — the layer above the guide library.
 *
 * A course arranges guides that already exist into chapters. It POINTS at them;
 * it never copies them, which is why none of this can disturb the guide save
 * (an atomic rebuild of every step) or the frozen guide copy sitting on each
 * day's task list.
 *
 * Design: docs/superpowers/specs/2026-08-07-staff-training-courses-design.md
 */
import { getOdoo } from './odoo';

export interface CourseSummary {
  id: number;
  name: string;
  company_id: number;
  published: boolean;
  chapter_count: number;
  guide_count: number;
  certificate: boolean;
}

export interface CourseGuideRef {
  link_id: number;
  guide_id: number;
  name: string;
  /** A DRAFT guide inside a course teaches nothing — staff never receive one,
   *  so the builder has to be able to say so. */
  published: boolean;
  step_count: number;
  question_count: number;
}

export interface CourseChapter {
  id: number;
  name: string;
  guides: CourseGuideRef[];
}

export interface CourseRead {
  id: number;
  name: string;
  description: string;
  company_id: number;
  published: boolean;
  revision: number;
  certificate: boolean;
  pass_mark: number;
  validity_months: number;
  reminder_lead_days: number;
  chapters: CourseChapter[];
}

/** What a save sends. Chapters are a whole-set replace — they are pointers, so
 *  rebuilding them cannot lose content. */
export interface CourseSave {
  name?: string;
  description?: string | null;
  published?: boolean;
  certificate?: boolean;
  pass_mark?: number;
  validity_months?: number;
  reminder_lead_days?: number;
  chapters?: { name: string; guides: { guide_id: number }[] }[];
}

export type CourseSaveResult =
  | { ok: true; revision: number }
  /** 'stale' means someone else saved while this editor was open. */
  | { ok: false; error: 'not-found' | 'stale'; revision?: number };

export function listCourses(allowedCompanyIds: number[]): Promise<CourseSummary[]> {
  return getOdoo().call('krawings.training.course', 'portal_list_courses', [allowedCompanyIds]);
}

export async function readCourse(
  courseId: number,
  allowedCompanyIds: number[],
): Promise<CourseRead | null> {
  const r: unknown = await getOdoo().call(
    'krawings.training.course', 'portal_read_course', [courseId, allowedCompanyIds],
  );
  return (r as CourseRead) || null;
}

export async function createCourse(
  name: string,
  companyId: number,
  allowedCompanyIds: number[],
): Promise<{ id: number; revision: number } | null> {
  const r: unknown = await getOdoo().call(
    'krawings.training.course', 'portal_create_course', [name, companyId, allowedCompanyIds],
  );
  return (r as { id: number; revision: number }) || null;
}

export function saveCourse(
  courseId: number,
  revision: number,
  payload: CourseSave,
  allowedCompanyIds: number[],
): Promise<CourseSaveResult> {
  return getOdoo().call(
    'krawings.training.course', 'portal_save_course',
    [courseId, revision, payload, allowedCompanyIds],
  );
}

export async function deleteCourse(
  courseId: number,
  allowedCompanyIds: number[],
): Promise<boolean> {
  return !!(await getOdoo().call(
    'krawings.training.course', 'portal_delete_course', [courseId, allowedCompanyIds],
  ));
}

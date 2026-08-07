/**
 * task-guide.ts — data layer for guided tutorials (Task Manager).
 *
 * Manager/admin editor CRUD on the TEMPLATE line's guide, and staff READ of the
 * daily snapshot. Backed by the krawings_task_manager addon:
 *   - krawings.task.template.line  portal_read_guide / portal_save_guide / portal_delete_guide
 *   - krawings.task.list.line      portal_read_guide (staff, company-scoped)
 *   - krawings.task.guide.step     get_media (photo/pdf bytes, fail-closed)
 *
 * A guide is purely instructional — nothing here ever completes a task. All
 * calls go through getOdoo() (server-side only). YouTube URLs are canonicalized
 * before save; the model also validates them.
 */

import { getOdoo } from './odoo';
import { canonicalYoutubeUrl } from './youtube-url';

export type GuideMediaType = 'photo' | 'youtube' | 'tip' | 'pdf';

export interface GuidePin {
  id?: number;
  pin_x: number;
  pin_y: number;
  note: string;
}

// Drawn marks live in their own client-safe module (no server imports); re-exported
// here so server code can keep importing everything guide-related from one place.
export {
  DRAWING_COLORS,
  MAX_DRAWINGS,
  MAX_DRAWING_POINTS,
  parseDrawings,
  serializeDrawings,
  hitTestDrawing,
} from './guide-drawings';
export type { GuideDrawing, GuideDrawingType } from './guide-drawings';

/** A step as read for the manager editor (media bytes fetched separately). */
export interface GuideStepRead {
  id: number;
  media_type: GuideMediaType;
  explanation: string;
  has_image: boolean;
  image_filename: string;
  has_pdf: boolean;
  pdf_filename: string;
  youtube_url: string;
  /** JSON string of GuideDrawing[] (empty when the step has none). */
  drawings: string;
  pins: GuidePin[];
}

export interface TemplateGuide {
  revision: number;
  published: boolean;
  steps: GuideStepRead[];
}

/** A step as sent on save. `id` present = keep/update an existing step;
 * a photo/pdf with no *_base64 keeps its current bytes server-side. */
export interface GuideStepSave {
  id?: number;
  media_type: GuideMediaType;
  explanation: string;
  image_base64?: string;
  image_filename?: string;
  pdf_base64?: string;
  pdf_filename?: string;
  youtube_url?: string;
  /** JSON string of GuideDrawing[]; omitted/'' clears the step's drawings. */
  drawings?: string;
  pins?: GuidePin[];
}

export interface SaveGuideResult {
  ok?: boolean;
  conflict?: boolean;
  revision: number;
}

export async function readTemplateGuide(templateLineId: number): Promise<TemplateGuide | null> {
  const r: unknown = await getOdoo().call('krawings.task.template.line', 'portal_read_guide', [templateLineId]);
  return (r as TemplateGuide) || null;
}

export async function saveTemplateGuide(
  templateLineId: number,
  revision: number,
  published: boolean,
  steps: GuideStepSave[],
): Promise<SaveGuideResult> {
  // Canonicalize YouTube links before storage (model validates too).
  const clean = steps.map(s =>
    s.media_type === 'youtube'
      ? { ...s, youtube_url: canonicalYoutubeUrl(s.youtube_url) || s.youtube_url }
      : s,
  );
  return getOdoo().call('krawings.task.template.line', 'portal_save_guide', [
    templateLineId, revision, published, clean,
  ]);
}

export async function deleteTemplateGuide(templateLineId: number): Promise<{ ok: boolean; revision: number }> {
  return getOdoo().call('krawings.task.template.line', 'portal_delete_guide', [templateLineId]);
}

/** A step as read by staff (no filenames beyond pdf; media via its own route). */
export interface StaffGuideStep {
  id: number;
  media_type: GuideMediaType;
  explanation: string;
  has_image: boolean;
  has_pdf: boolean;
  pdf_filename: string;
  youtube_url: string;
  /** JSON string of GuideDrawing[] (empty when the step has none). */
  drawings: string;
  pins: { pin_x: number; pin_y: number; note: string }[];
}

export interface StaffGuide {
  line_name: string;
  steps: StaffGuideStep[];
}

export async function readListGuide(listLineId: number, allowedCompanyIds: number[]): Promise<StaffGuide | null> {
  const r: unknown = await getOdoo().call('krawings.task.list.line', 'portal_read_guide', [
    listLineId, allowedCompanyIds,
  ]);
  return (r as StaffGuide) || null;
}

export interface GuideMediaBytes {
  filename: string;
  mimetype: string;
  data_base64: string;
}

/**
 * Photo or PDF bytes for one step. `kind`:
 *   - 'guide'    library guide step (manager editor / staff Training)
 *   - 'list'     daily snapshot step (staff daily player)
 *   - 'template' LEGACY editable-source kind (kept for back-compat)
 * When `parentId` is given the step must belong to that parent (guide id / list
 * line id) — closes a same-company step-id substitution gap. Fails closed.
 */
export async function getStepMedia(
  kind: 'guide' | 'template' | 'list',
  stepId: number,
  allowedCompanyIds: number[],
  parentId?: number,
): Promise<GuideMediaBytes | null> {
  const r: unknown = await getOdoo().call('krawings.task.guide.step', 'get_media', [
    kind, stepId, allowedCompanyIds, parentId ?? null,
  ]);
  return (r as GuideMediaBytes) || null;
}

// ── Reusable guide LIBRARY (krawings.task.guide) ──────────────────────────

/** Headline row for the Library list + task picker. */
export interface LibraryGuideSummary {
  id: number;
  name: string;
  company_id: number;
  published: boolean;
  revision: number;
  step_count: number;
  template_line_count: number;
}

/** A full library guide for the editor (steps; media bytes fetched separately). */
export interface LibraryGuide {
  id: number;
  name: string;
  company_id: number;
  revision: number;
  published: boolean;
  template_line_count: number;
  steps: GuideStepRead[];
}

export async function listLibraryGuides(allowedCompanyIds: number[]): Promise<LibraryGuideSummary[]> {
  const r: unknown = await getOdoo().call('krawings.task.guide', 'portal_list_guides', [allowedCompanyIds]);
  return (Array.isArray(r) ? r : []) as LibraryGuideSummary[];
}

export async function readLibraryGuide(guideId: number): Promise<LibraryGuide | null> {
  const r: unknown = await getOdoo().call('krawings.task.guide', 'portal_read_guide', [guideId]);
  return (r as LibraryGuide) || null;
}

export interface GuideQuestion {
  id?: number;
  text: string;
  /** 1-based step POSITION that teaches the answer, 0 for none. Never a step
   *  id — saving a guide destroys and reissues every one of those. */
  explain_step: number;
  answers: { text: string; is_correct: boolean }[];
}

/** Replace a guide's questions. Separate from the step save on purpose: that
 *  one is an atomic rebuild of the whole aggregate, and a bug here must not be
 *  able to cost anyone their step photos. Returns how many were kept. */
export async function saveGuideQuestions(
  guideId: number,
  questions: GuideQuestion[],
  allowedCompanyIds: number[],
): Promise<number> {
  const kept: unknown = await getOdoo().call(
    'krawings.task.guide', 'portal_save_questions', [guideId, questions, allowedCompanyIds],
  );
  return typeof kept === 'number' ? kept : 0;
}

export async function createLibraryGuide(name: string, companyId: number): Promise<{ id: number; revision: number }> {
  return getOdoo().call('krawings.task.guide', 'portal_create_guide', [name, companyId]);
}

export async function saveLibraryGuide(
  guideId: number,
  revision: number,
  published: boolean,
  steps: GuideStepSave[],
  name?: string,
): Promise<SaveGuideResult> {
  const clean = steps.map(s =>
    s.media_type === 'youtube'
      ? { ...s, youtube_url: canonicalYoutubeUrl(s.youtube_url) || s.youtube_url }
      : s,
  );
  return getOdoo().call('krawings.task.guide', 'portal_save_guide', [
    guideId, revision, published, clean, name ?? null,
  ]);
}

export async function deleteLibraryGuide(guideId: number): Promise<{ ok: boolean }> {
  return getOdoo().call('krawings.task.guide', 'portal_delete_guide', [guideId]);
}

// ── Task ↔ guide link (attach / detach; many tasks → one guide) ───────────

export interface GuideLink {
  template_line_id: number;
  guide_id: number | false;
  name: string;
  published: boolean;
  revision: number;
  step_count: number;
}

export async function getTemplateLineGuideLink(templateLineId: number): Promise<GuideLink | null> {
  const r: unknown = await getOdoo().call('krawings.task.template.line', 'portal_guide_link', [templateLineId]);
  return (r as GuideLink) || null;
}

/** Attach a guide (guideId) or detach (null). Never edits guide content. */
export async function attachGuideToTemplateLine(
  templateLineId: number,
  guideId: number | null,
): Promise<GuideLink> {
  return getOdoo().call('krawings.task.template.line', 'portal_attach_guide', [
    templateLineId, guideId ?? false,
  ]);
}

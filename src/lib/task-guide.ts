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

/** Photo or PDF bytes for one step. kind: 'template' (editor) | 'list' (daily). */
export async function getStepMedia(
  kind: 'template' | 'list',
  stepId: number,
  allowedCompanyIds: number[],
): Promise<GuideMediaBytes | null> {
  const r: unknown = await getOdoo().call('krawings.task.guide.step', 'get_media', [
    kind, stepId, allowedCompanyIds,
  ]);
  return (r as GuideMediaBytes) || null;
}

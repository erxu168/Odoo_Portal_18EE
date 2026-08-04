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

/** One mark the guide's author drew over a photo to emphasise something.
 * Coordinates are fractions 0..1 of the image — the same space as pins, so a
 * drawing lands on the same spot on any screen. arrow/circle/box carry exactly
 * two points (start, end); pen carries the whole stroke. */
export type GuideDrawingType = 'arrow' | 'circle' | 'box' | 'pen';
export interface GuideDrawing {
  type: GuideDrawingType;
  /** #RRGGBB — rendered into an SVG attribute, so it is validated, not escaped. */
  color: string;
  points: [number, number][];
}

export const DRAWING_COLORS = ['#DC2626', '#2563EB', '#16A34A', '#FFFFFF'] as const;
export const MAX_DRAWINGS = 40;
export const MAX_DRAWING_POINTS = 400;
const DRAWING_TYPES: GuideDrawingType[] = ['arrow', 'circle', 'box', 'pen'];
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * Parse a stored drawings JSON string into shapes, dropping anything malformed.
 * Never throws: a corrupt or hand-edited value must degrade to "no drawings"
 * rather than break the photo for staff mid-shift. The server validates on save
 * (normalize_drawings) — this is the render-side guard.
 */
export function parseDrawings(raw: string | null | undefined): GuideDrawing[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const out: GuideDrawing[] = [];
  for (const s of data.slice(0, MAX_DRAWINGS)) {
    if (!s || typeof s !== 'object') continue;
    const shape = s as Record<string, unknown>;
    const type = shape.type as GuideDrawingType;
    const color = typeof shape.color === 'string' ? shape.color : '';
    if (!DRAWING_TYPES.includes(type) || !HEX_COLOR.test(color)) continue;
    if (!Array.isArray(shape.points) || shape.points.length === 0) continue;
    const points: [number, number][] = [];
    for (const p of shape.points.slice(0, MAX_DRAWING_POINTS)) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const x = Number(p[0]); const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
    }
    if (!points.length) continue;
    if (type !== 'pen' && points.length !== 2) continue;
    out.push({ type, color, points });
  }
  return out;
}

/** Serialise shapes for save. Empty list → '' so the server stores nothing.
 * Coordinates are rounded to 4 decimals (finer than a finger can aim) to keep
 * the stored JSON small — it is deep-copied into every daily snapshot. */
export function serializeDrawings(shapes: GuideDrawing[]): string {
  if (!shapes.length) return '';
  return JSON.stringify(shapes.map(s => ({
    type: s.type,
    color: s.color,
    points: s.points.map(([x, y]) => [round4(x), round4(y)] as [number, number]),
  })));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Index of the mark nearest to (x, y) within `tol` (all in 0..1 fractions), or
 * -1. Used by the editor's erase tool so an author can remove ONE mark instead
 * of undoing everything. Later shapes win ties — they are the ones drawn on top. */
export function hitTestDrawing(shapes: GuideDrawing[], x: number, y: number, tol = 0.04): number {
  let best = -1;
  let bestD = tol;
  for (let i = 0; i < shapes.length; i++) {
    const d = distanceToShape(shapes[i], x, y);
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

function distanceToShape(s: GuideDrawing, x: number, y: number): number {
  const [sx, sy] = s.points[0];
  const [ex, ey] = s.points[s.points.length - 1];
  if (s.type === 'arrow') return distToSegment(x, y, sx, sy, ex, ey);
  if (s.type === 'pen') {
    let d = Infinity;
    for (let i = 1; i < s.points.length; i++) {
      const [ax, ay] = s.points[i - 1];
      const [bx, by] = s.points[i];
      d = Math.min(d, distToSegment(x, y, ax, ay, bx, by));
    }
    return d;
  }
  // circle / box — distance to the outline of their bounding box, which is a
  // good enough proxy for tapping "on" either shape.
  const x0 = Math.min(sx, ex), x1 = Math.max(sx, ex);
  const y0 = Math.min(sy, ey), y1 = Math.max(sy, ey);
  const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const dx = Math.min(Math.abs(x - x0), Math.abs(x - x1));
  const dy = Math.min(Math.abs(y - y0), Math.abs(y - y1));
  if (inside) return Math.min(dx, dy);
  const cx = Math.max(x0, Math.min(x, x1));
  const cy = Math.max(y0, Math.min(y, y1));
  return Math.hypot(x - cx, y - cy);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
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

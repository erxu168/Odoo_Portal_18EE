/**
 * guide-drawings.ts — the author's drawn marks over a guide photo.
 *
 * Deliberately SEPARATE from task-guide.ts and free of any server import: these
 * helpers run in client components (the editor, the player, PinnableImage,
 * DrawingLayer). task-guide.ts pulls in lib/odoo (next/headers), so importing a
 * runtime value from there into a client component drags the server-only Odoo
 * client into the browser bundle and the build fails. Types alone are erased at
 * compile time and are safe; VALUES are not — hence this module.
 */

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

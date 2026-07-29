/**
 * Inventory Floorplan — pure geometry + label extraction helpers.
 *
 * Dependency-free on purpose: this file runs BOTH in the browser (upload
 * pipeline, pdf.js text items) and in Node (unit tests, publish validation).
 *
 * Coordinate spaces:
 *  - pdf.js text items live in PDF page space (points, y grows UP), with the
 *    font scale baked into the transform and width/height already in page
 *    units — so the polygon math uses the transform's UNIT direction vectors,
 *    never the raw matrix (which would double-apply the font size).
 *  - everything we store is page FRACTIONS (0–1, y grows DOWN) — see types.ts.
 */
import type { Pt } from './types';

export interface RawTextItem {
  str: string;
  transform: number[]; // [a,b,c,d,e,f] text→page
  width: number;       // page units along the baseline
  height: number;      // page units along the up direction
}

export interface TextToken {
  str: string;
  poly: Pt[];          // 4 corners, page fractions (baseline-start first)
  angle: number;       // degrees, PDF-space CCW
  fontH: number;       // page units
  /** page-POINT-space geometry kept for grouping math (fractions distort angles) */
  px: { ox: number; oy: number; ux: number; uy: number; w: number; h: number };
}

export interface TokenGroup {
  text: string;
  poly: Pt[];
  angle: number;
}

/** Corners of a text item: origin, +baseline, +baseline+up, +up — as page fractions, y down. */
export function textItemPolygon(item: RawTextItem, pageW: number, pageH: number): Pt[] {
  const [a, b, c, d, e, f] = item.transform;
  const su = Math.hypot(a, b) || 1;
  const sv = Math.hypot(c, d) || 1;
  const ux = a / su, uy = b / su;
  const vx = c / sv, vy = d / sv;
  const w = item.width, h = item.height;
  const corners = [
    [e, f],
    [e + ux * w, f + uy * w],
    [e + ux * w + vx * h, f + uy * w + vy * h],
    [e + vx * h, f + vy * h],
  ];
  return corners.map(([x, y]) => ({ x: x / pageW, y: 1 - y / pageH }));
}

/** Baseline rotation in PDF space, degrees CCW, rounded. 0 = normal horizontal text. */
export function rotationDegrees(transform: number[]): number {
  return Math.round((Math.atan2(transform[1], transform[0]) * 180) / Math.PI);
}

export function polygonCentroid(poly: Pt[]): Pt {
  const n = poly.length || 1;
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  };
}

export function normalizeCode(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase();
}

const STORAGE_TYPE: Record<string, string> = {
  SLF: 'shelf',
  FLS: 'floorspace',
  CAB: 'cabinet',
  REF: 'fridge',
  FRZ: 'freezer',
};

const ROOM_RE = /\b(room|area|wash|dispatch|office|treppenhaus)\b/i;
const ENTRY_RE = /^entry\/?\s*exit/i;

/** What a grouped label most likely is. The reviewer always has the last word. */
export function classify(text: string): { kind: 'spot' | 'room' | 'other'; type?: string } {
  const t = normalizeCode(text);
  const m = t.match(/^(SLF|FLS|CAB|REF|FRZ)(?: ?(\d{1,2}))?$/);
  if (m) return { kind: 'spot', type: STORAGE_TYPE[m[1]] };
  if (text.trim().length < 40 && (ROOM_RE.test(text) || ENTRY_RE.test(text.trim()))) {
    return { kind: 'room' };
  }
  return { kind: 'other' };
}

const FULL_CODE_RE = /^(SLF|FLS|CAB|REF|FRZ) ?\d{1,2}$/i;
const MULTI_CODE_RE = /^(?:(?:SLF|FLS|CAB|REF|FRZ) ?\d{1,2})(?: +(?:SLF|FLS|CAB|REF|FRZ) ?\d{1,2})+$/i;

/**
 * pdf.js sometimes PRE-JOINS two adjacent labels into one item ("SLF 3 SLF 4"
 * on the real plan). Split such an item into per-code sub-items, dividing the
 * advance width proportionally by character share along the baseline — exact
 * for the rotated case too, since we offset the origin along the unit baseline.
 */
function splitMultiCode(item: RawTextItem): RawTextItem[] {
  const trimmed = item.str.trim();
  if (!MULTI_CODE_RE.test(trimmed)) return [item];
  const codes = trimmed.match(/(SLF|FLS|CAB|REF|FRZ) ?\d{1,2}/gi) ?? [];
  if (codes.length < 2) return [item];
  const [a, b, c, d, e, f] = item.transform;
  const su = Math.hypot(a, b) || 1;
  const ux = a / su, uy = b / su;
  const totalChars = trimmed.length;
  let cursor = 0;
  return codes.map(code => {
    const at = trimmed.indexOf(code, cursor);
    const startFrac = at / totalChars;
    const widthFrac = code.length / totalChars;
    cursor = at + code.length;
    return {
      str: code,
      transform: [a, b, c, d, e + ux * item.width * startFrac, f + uy * item.width * startFrac],
      width: item.width * widthFrac,
      height: item.height,
    };
  });
}

/** Convert raw pdf.js items into tokens carrying both fraction + point-space geometry. */
export function itemsToTokens(items: RawTextItem[], pageW: number, pageH: number): TextToken[] {
  return items.flatMap(splitMultiCode).map(item => {
    const [a, b, c, d, e, f] = item.transform;
    const su = Math.hypot(a, b) || 1;
    return {
      str: item.str,
      poly: textItemPolygon(item, pageW, pageH),
      angle: rotationDegrees(item.transform),
      fontH: item.height || su,
      px: { ox: e, oy: f, ux: a / su, uy: b / su, w: item.width, h: item.height || su },
    };
  });
}

const BARE_TYPE_RE = /^(SLF|FLS|CAB|REF|FRZ)$/i;
const BARE_NUM_RE = /^\d{1,2}$/;

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/**
 * Group pdf.js tokens into visual labels. Two joins exist on the real plans:
 *  - SAME LINE: continuation along the baseline within a small gap
 *    (multi-word room names when pdf.js splits them);
 *  - STACKED: the small square storage labels are two lines — a bare type
 *    word ("FLS") with a bare number centered BELOW it. Stacking is only
 *    allowed for that exact shape, otherwise adjacent complete codes
 *    ("SLF 1" next to "SLF 2") would merge into nonsense.
 */
export function groupTokens(tokens: TextToken[], _pageW: number, _pageH: number): TokenGroup[] {
  const n = tokens.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i: number, j: number) => { parent[find(i)] = find(j); };

  // token center + projections in ITS OWN (baseline u, up v) frame, page points
  const proj = tokens.map(t => {
    const { ox, oy, ux, uy, w, h } = t.px;
    const cx = ox + ux * (w / 2) - uy * (h / 2) * 0; // center along baseline; v handled below
    const cy = oy + uy * (w / 2);
    return { cx, cy };
  });

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = tokens[i], B = tokens[j];
      if (angleDiff(A.angle, B.angle) > 3) continue;
      const fh = Math.max(A.fontH, B.fontH);
      if (Math.min(A.fontH, B.fontH) < fh * 0.7) continue; // different type sizes never join

      // shared frame from A: u = baseline, v = up
      const { ux, uy } = A.px;
      const vxn = -uy, vyn = ux; // rotate u by +90° = PDF "up" for this baseline
      const dx = proj[j].cx - proj[i].cx;
      const dy = proj[j].cy - proj[i].cy;
      const along = dx * ux + dy * uy;
      const perp = dx * vxn + dy * vyn;

      const wA = A.px.w, wB = B.px.w;

      // A complete storage code IS a complete label — it never continues into a
      // neighbour ("SLF 1" beside "SLF 2", or "CAB 1" beside the named
      // "Shelf 3" box, must stay separate labels).
      const anyFullCode = FULL_CODE_RE.test(A.str.trim()) || FULL_CODE_RE.test(B.str.trim());

      const sameLine =
        !anyFullCode &&
        Math.abs(perp) <= 0.5 * fh &&
        Math.abs(along) - (wA + wB) / 2 <= 0.9 * fh &&
        Math.abs(along) >= (wA + wB) / 2 - 0.3 * fh;

      // stacked line 2 under line 1 — either the square storage label
      // (bare type word + bare number, number centered) or a two-line room
      // name ("Fridge" over "Room"): plain words only, digits never stack.
      const codePair = (t1: TextToken, t2: TextToken) =>
        BARE_TYPE_RE.test(t1.str.trim()) && BARE_NUM_RE.test(t2.str.trim());
      const WORD_RE = /^[A-Za-zÄÖÜäöüß/().\- ]+$/;
      const wordPair = !anyFullCode && WORD_RE.test(A.str.trim()) && WORD_RE.test(B.str.trim());
      const stacked =
        (codePair(A, B) || codePair(B, A) || wordPair) &&
        Math.abs(along) <= Math.max(wA, wB) * 0.6 && // horizontally overlapping
        Math.abs(perp) >= 0.5 * fh &&
        Math.abs(perp) <= 1.9 * fh;

      if (sameLine || stacked) union(i, j);
    }
  }

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(i);
  }

  const groups: TokenGroup[] = [];
  for (const idxs of Array.from(buckets.values())) {
    const members = idxs.map(i => tokens[i]);
    const ref = members[0];
    const { ux, uy } = ref.px;
    const vxn = -uy, vyn = ux;
    // reading order: top line first (higher v in PDF space), then along the baseline
    const ordered = members.slice().sort((a, b) => {
      const av = proj[tokens.indexOf(a)], bv = proj[tokens.indexOf(b)];
      const aPerp = av.cx * vxn + av.cy * vyn;
      const bPerp = bv.cx * vxn + bv.cy * vyn;
      if (Math.abs(aPerp - bPerp) > 0.5 * ref.fontH) return bPerp - aPerp;
      const aAlong = av.cx * ux + av.cy * uy;
      const bAlong = bv.cx * ux + bv.cy * uy;
      return aAlong - bAlong;
    });
    const allPts = members.flatMap(m => m.poly);
    const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
    // Axis-aligned union in fraction space is fine for the group BOX; the
    // per-token polygons keep exact rotation for hit areas downstream.
    const poly: Pt[] = [
      { x: Math.min(...xs), y: Math.min(...ys) },
      { x: Math.max(...xs), y: Math.min(...ys) },
      { x: Math.max(...xs), y: Math.max(...ys) },
      { x: Math.min(...xs), y: Math.max(...ys) },
    ];
    groups.push({
      text: ordered.map(m => m.str.trim()).filter(Boolean).join(' '),
      poly,
      angle: ref.angle,
    });
  }
  return groups;
}

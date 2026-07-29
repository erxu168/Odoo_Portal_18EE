/**
 * Inventory Floorplan — browser-side PDF processing at upload time.
 *
 * The manager's device does the heavy lifting so the server needs no PDF
 * binaries at all: pdf.js renders the chosen page to a capped raster
 * (WebP, PNG fallback) AND extracts the text labels with geometry, which the
 * upload route then re-validates. Runs ONLY in the browser (canvas, File).
 */
import {
  itemsToTokens, groupTokens, classify, normalizeCode, rotationDegrees as rotDeg,
  type RawTextItem,
} from './geometry';
import type { Pt } from './types';

export interface CandidateDraft {
  rawText: string;
  normalizedText: string;
  polygon: Pt[];
  rotationDegrees: number;
  proposedKind: 'spot' | 'room' | 'other';
  proposedType?: string | null;
  proposedRoom?: string | null;
}

export interface ProcessedPdf {
  raster: Blob;
  meta: {
    pageNumber: number;
    pageCount: number;
    pageWidth: number;
    pageHeight: number;
    rotation: number;
    rasterWidth: number;
    rasterHeight: number;
    mime: string;
  };
  candidates: CandidateDraft[];
}

/** Render caps: 4096 px long edge (pre-iOS-18 Safari canvas limit) and ~12 MP. */
const MAX_EDGE_STEPS = [4096, 3072, 2048];
const MAX_PIXELS = 12_000_000;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<{ blob: Blob; mime: string }> {
  return new Promise((resolve, reject) => {
    // Lossless-leaning WebP keeps thin plan lines crisp; Safari < 16 falls back to PNG.
    canvas.toBlob(webp => {
      if (webp && webp.type === 'image/webp') { resolve({ blob: webp, mime: 'image/webp' }); return; }
      canvas.toBlob(png => {
        if (png) resolve({ blob: png, mime: 'image/png' });
        else reject(new Error('Could not render the plan image'));
      }, 'image/png');
    }, 'image/webp', 0.98);
  });
}

export async function countPdfPages(file: File): Promise<number> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

export async function processPdf(file: File, pageNumber = 1): Promise<ProcessedPdf> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    if ((base.rotation ?? 0) % 360 !== 0) {
      throw new Error('This page is rotated — export it upright from Illustrator and try again');
    }

    // ---- raster, stepping down if the device refuses the allocation --------
    let rendered: { blob: Blob; mime: string; width: number; height: number } | null = null;
    for (const maxEdge of MAX_EDGE_STEPS) {
      const edgeScale = maxEdge / Math.max(base.width, base.height);
      const pixelScale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
      const scale = Math.min(edgeScale, pixelScale);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      try {
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const { blob, mime } = await canvasToBlob(canvas);
        // The server caps the upload at 15 MB — an unusually dense plan can
        // encode too large at full size; step down instead of failing later.
        if (blob.size > 14 * 1024 * 1024) continue;
        rendered = { blob, mime, width: canvas.width, height: canvas.height };
        break;
      } catch {
        // allocation/render failure — try the next smaller size
      } finally {
        canvas.width = 0; canvas.height = 0; // release the bitmap eagerly (iOS)
      }
    }
    if (!rendered) throw new Error('This device could not render the plan — try uploading from a computer');

    // ---- label extraction ---------------------------------------------------
    const tc = await page.getTextContent();
    const items = (tc.items as RawTextItem[]).filter(i => typeof i.str === 'string' && i.str.trim() !== '');
    const tokens = itemsToTokens(items, base.width, base.height);
    const groups = groupTokens(tokens, base.width, base.height);
    const candidates: CandidateDraft[] = groups.map(g => {
      const normalized = normalizeCode(g.text);
      const cls = classify(normalized);
      return {
        rawText: g.text,
        normalizedText: normalized,
        polygon: g.poly,
        rotationDegrees: g.angle,
        proposedKind: cls.kind,
        proposedType: cls.type ?? null,
      };
    });

    return {
      raster: rendered.blob,
      meta: {
        pageNumber,
        pageCount: doc.numPages,
        pageWidth: base.width,
        pageHeight: base.height,
        rotation: base.rotation ?? 0,
        rasterWidth: rendered.width,
        rasterHeight: rendered.height,
        mime: rendered.mime,
      },
      candidates,
    };
  } finally {
    await doc.destroy();
  }
}

/** Build the multipart body the revisions endpoint expects. */
export function buildRevisionFormData(file: File, processed: ProcessedPdf): FormData {
  const form = new FormData();
  form.append('pdf', file);
  const ext = processed.meta.mime === 'image/webp' ? 'webp' : 'png';
  form.append('raster', new File([processed.raster], `plan.${ext}`, { type: processed.meta.mime }));
  form.append('meta', JSON.stringify(processed.meta));
  form.append('candidates', JSON.stringify(processed.candidates));
  return form;
}

/**
 * Propose a room for every spot candidate: the nearest detected room label.
 * The owner's plans put the room name inside the room, so nearest-centroid is
 * right most of the time; where numbering would collide inside one room the
 * next-nearest room is proposed instead (the reviewer has the final word, and
 * publish still blocks real duplicates).
 */
export function suggestRooms(candidates: CandidateDraft[], pageWidth = 1, pageHeight = 1): CandidateDraft[] {
  const centroid = (poly: Pt[]): Pt => ({
    x: poly.reduce((s, p) => s + p.x, 0) / (poly.length || 1),
    y: poly.reduce((s, p) => s + p.y, 0) / (poly.length || 1),
  });
  // Distances in PAGE POINTS, not fractions — fraction axes have different
  // physical scales on non-square pages and can flip "nearest" (audit finding).
  const dx = (a: number, b: number) => (a - b) * pageWidth;
  const dy = (a: number, b: number) => (a - b) * pageHeight;
  const rooms = candidates
    .filter(c => c.proposedKind === 'room')
    .map(c => ({ name: c.rawText.trim(), c: centroid(c.polygon) }));
  if (rooms.length === 0) return candidates;

  const taken = new Set<string>();
  return candidates.map(cand => {
    if (cand.proposedKind !== 'spot') return cand;
    const c = centroid(cand.polygon);
    const byDist = rooms
      .map(r => ({ name: r.name, d: Math.hypot(dx(c.x, r.c.x), dy(c.y, r.c.y)) }))
      .sort((a, b) => a.d - b.d);
    let room: string | null = null;
    for (const r of byDist) {
      const key = `${r.name}|${cand.normalizedText}`;
      if (!taken.has(key)) { room = r.name; taken.add(key); break; }
    }
    return { ...cand, proposedRoom: room };
  });
}

// re-exported so upload UI can show per-candidate rotation without importing geometry
export { rotDeg as rotationDegrees };

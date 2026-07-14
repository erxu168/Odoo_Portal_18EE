/**
 * Delivery-note PDF helper.
 * Combines 1+ delivery-note photos into a single multi-page PDF for the
 * purchase receive flow. No OCR — the note is stored as a document.
 *
 * buildImagesHtml is pure (unit-testable); imagesToPdf drives the shared
 * htmlToPdf() (Puppeteer, wkhtmltopdf fallback) used elsewhere in the portal.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
// Relative (sibling) import on purpose: keeps the pure buildImagesHtml import
// chain free of the '@/' alias so the unit test resolves without tsconfig paths.
import { htmlToPdf } from './pdf-generator';

/** One full-page image per delivery-note photo. Pure — no I/O. */
export function buildImagesHtml(dataUrls: string[]): string {
  const pages = dataUrls
    .map((src) => `<div class="page"><img src="${src}" /></div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    .page { width: 100%; height: 100vh; display: flex; align-items: center;
            justify-content: center; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style></head><body>${pages}</body></html>`;
}

/** Combine image data URLs into a single PDF buffer. */
export async function imagesToPdf(dataUrls: string[]): Promise<Buffer> {
  if (!dataUrls.length) throw new Error('imagesToPdf: no images provided');
  const html = buildImagesHtml(dataUrls);
  const outPath = path.join(
    os.tmpdir(),
    `dnote_${process.pid}_${Date.now()}.pdf`,
  );
  try {
    await htmlToPdf(html, outPath);
    return fs.readFileSync(outPath);
  } finally {
    try { fs.unlinkSync(outPath); } catch { /* best-effort cleanup */ }
  }
}

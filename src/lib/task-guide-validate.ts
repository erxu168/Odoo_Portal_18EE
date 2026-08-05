/**
 * task-guide-validate.ts — shared server-side validation for guide saves.
 *
 * Used by both the library guide route (/api/tasks/guides/[guideId]) and the
 * legacy per-task guide route. Validates the REAL bytes (never trusts filename
 * / Content-Type), and gates COMPLETENESS on `published`: a draft may hold
 * half-finished steps (empty explanation, no photo yet) while structural checks
 * (valid bytes / valid YouTube if present; note-pins need a note) always apply.
 * Mirrors the Odoo model's rules.
 */

import { AuthError } from '@/lib/auth';
import { sanitizeRichText, richTextToPlain } from './rich-text';
import { MAX_RICH_TEXT_BYTES } from './task-limits';
import { isValidYoutubeUrl } from '@/lib/youtube-url';
import { parseDrawings, serializeDrawings, type GuideStepSave } from '@/lib/task-guide';

export const GUIDE_MEDIA_TYPES = new Set(['photo', 'youtube', 'tip', 'pdf']);

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isImage(base64: string): boolean {
  let h: Buffer;
  try { h = Buffer.from(base64.slice(0, 24), 'base64'); } catch { return false; }
  if (h.length < 12) return false;
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return true;                 // JPEG
  if (h.subarray(0, 8).equals(PNG_SIG)) return true;                                // PNG
  const g = h.subarray(0, 6).toString('ascii');
  if (g === 'GIF87a' || g === 'GIF89a') return true;                                // GIF
  if (h.subarray(0, 4).toString('ascii') === 'RIFF'
      && h.subarray(8, 12).toString('ascii') === 'WEBP') return true;              // WEBP
  return false;
}

export function isPdf(base64: string): boolean {
  try { return Buffer.from(base64.slice(0, 8), 'base64').subarray(0, 5).toString('ascii') === '%PDF-'; }
  catch { return false; }
}

/** Validate + normalize the incoming steps array (server-side; the Odoo model
 * also validates). Throws AuthError with a user-facing message + status. */
export function sanitizeSteps(raw: unknown, published: boolean): GuideStepSave[] {
  if (!Array.isArray(raw)) throw new AuthError('steps must be an array', 400);
  return raw.map((s: any, i: number) => {
    const mt = s?.media_type;
    if (!GUIDE_MEDIA_TYPES.has(mt)) throw new AuthError(`Step ${i + 1}: unknown type`, 400);
    // Sanitise here too: this route is a public entry point, so a hand-crafted
    // POST must not be able to store markup the editor would never produce.
    // Emptiness is judged on the WORDS — <p></p> is an empty editor.
    const rawExplanation = String(s?.explanation ?? '').trim();
    if (rawExplanation.length > MAX_RICH_TEXT_BYTES) {
      throw new AuthError(`Step ${i + 1}: that explanation is too large`, 400);
    }
    const explanation = sanitizeRichText(rawExplanation);
    const explanationText = richTextToPlain(explanation);
    if (published && !explanationText) throw new AuthError(`Step ${i + 1}: an explanation is required`, 400);
    const out: GuideStepSave = { media_type: mt, explanation: explanationText ? explanation : '' };
    if (Number.isInteger(s?.id)) out.id = s.id;
    if (mt === 'photo') {
      if (s?.image_base64) {
        if (!isImage(s.image_base64)) throw new AuthError(`Step ${i + 1}: not a valid image`, 415);
        out.image_base64 = s.image_base64;
        out.image_filename = String(s?.image_filename ?? 'photo.jpg');
      } else if (published && !Number.isInteger(s?.id)) {
        throw new AuthError(`Step ${i + 1}: a photo is required`, 400);
      }
      const pins = Array.isArray(s?.pins) ? s.pins.map((p: any) => ({
        pin_x: Number(p?.pin_x) || 0, pin_y: Number(p?.pin_y) || 0, note: String(p?.note ?? '').trim(),
      })) : [];
      if (pins.some((p: { note: string }) => !p.note)) throw new AuthError(`Step ${i + 1}: every note-pin needs a note`, 400);
      out.pins = pins;
      // Author's drawn marks. Re-serialise from the PARSED shapes rather than
      // passing the client string through: anything malformed is dropped here
      // (and the Odoo model validates again before it is stored).
      //
      // ALWAYS send the key when the client sent one — including '' — because
      // the server treats an ABSENT key as "keep what's stored" (so an older
      // client that has never heard of drawings can't wipe them). Omitting ''
      // here would make "Clear" silently do nothing.
      if (s?.drawings !== undefined) {
        out.drawings = serializeDrawings(parseDrawings(typeof s.drawings === 'string' ? s.drawings : ''));
      }
    } else if (mt === 'pdf') {
      if (s?.pdf_base64) {
        if (!isPdf(s.pdf_base64)) throw new AuthError(`Step ${i + 1}: not a valid PDF`, 415);
        out.pdf_base64 = s.pdf_base64;
        out.pdf_filename = String(s?.pdf_filename ?? 'document.pdf');
      } else if (published && !Number.isInteger(s?.id)) {
        throw new AuthError(`Step ${i + 1}: a PDF is required`, 400);
      }
    } else if (mt === 'youtube') {
      const url = String(s?.youtube_url ?? '').trim();
      if (url) {
        if (!isValidYoutubeUrl(url)) throw new AuthError(`Step ${i + 1}: enter a valid YouTube link`, 400);
        out.youtube_url = url;
      } else if (published) {
        throw new AuthError(`Step ${i + 1}: a YouTube link is required`, 400);
      }
    }
    return out;
  });
}

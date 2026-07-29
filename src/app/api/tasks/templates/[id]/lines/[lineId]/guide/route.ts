import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { templateLineBelongsToTemplate, getTemplateCompany } from '@/lib/odoo-tasks';
import { readTemplateGuide, saveTemplateGuide, deleteTemplateGuide, type GuideStepSave } from '@/lib/task-guide';
import { isValidYoutubeUrl } from '@/lib/youtube-url';

export const dynamic = 'force-dynamic';

const MEDIA_TYPES = new Set(['photo', 'youtube', 'tip', 'pdf']);

function ids(params: { id: string; lineId: string }): { templateId: number; lineId: number } | null {
  const templateId = parseInt(params.id, 10);
  const lineId = parseInt(params.lineId, 10);
  if (Number.isNaN(templateId) || Number.isNaN(lineId)) return null;
  return { templateId, lineId };
}

/** Line must belong to the template AND the template's company must be allowed. */
async function assertScope(user: PortalUser, templateId: number, lineId: number): Promise<void> {
  if (!(await templateLineBelongsToTemplate(templateId, lineId))) throw new AuthError('Not found', 404);
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (allowed.length) {
    const company = await getTemplateCompany(templateId);
    if (company !== null && !allowed.includes(company)) throw new AuthError('Forbidden', 403);
  }
}

// Never trust filename/Content-Type — validate the real bytes.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function isImage(base64: string): boolean {
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
function isPdf(base64: string): boolean {
  try { return Buffer.from(base64.slice(0, 8), 'base64').subarray(0, 5).toString('ascii') === '%PDF-'; }
  catch { return false; }
}

/** Validate + normalize the incoming steps array (server-side; the model also validates). */
function sanitizeSteps(raw: unknown, published: boolean): GuideStepSave[] {
  if (!Array.isArray(raw)) throw new AuthError('steps must be an array', 400);
  // `published` gates COMPLETENESS: a draft may hold half-finished steps (empty
  // explanation, no photo yet). Structural checks (valid bytes / valid YouTube
  // if present, note-pins need a note) always apply. Mirrors the Odoo model.
  return raw.map((s: any, i: number) => {
    const mt = s?.media_type;
    if (!MEDIA_TYPES.has(mt)) throw new AuthError(`Step ${i + 1}: unknown type`, 400);
    const explanation = String(s?.explanation ?? '').trim();
    if (published && !explanation) throw new AuthError(`Step ${i + 1}: an explanation is required`, 400);
    const out: GuideStepSave = { media_type: mt, explanation };
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

export async function GET(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireRole('manager');
    const p = ids(params);
    if (!p) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, p.templateId, p.lineId);
    const guide = await readTemplateGuide(p.lineId);
    const res = NextResponse.json(guide || { revision: 0, published: false, steps: [] });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET guide error:', err);
    return NextResponse.json({ error: 'Failed to load guide' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireRole('manager');
    const p = ids(params);
    if (!p) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, p.templateId, p.lineId);
    const body = await req.json();
    const revision = Number(body?.revision);
    if (!Number.isInteger(revision)) return NextResponse.json({ error: 'Missing revision' }, { status: 400 });
    const published = !!body?.published;
    const steps = sanitizeSteps(body?.steps, published);
    const result = await saveTemplateGuide(p.lineId, revision, published, steps);
    if (result?.conflict) {
      return NextResponse.json(
        { error: 'This guide was changed in another window. Reload and try again.', revision: result.revision },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, revision: result.revision });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT guide error:', err);
    // Odoo validation surfaces as a UserError message — pass it through (it's user-facing copy).
    const message = err instanceof Error ? err.message : 'Failed to save guide';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireRole('manager');
    const p = ids(params);
    if (!p) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, p.templateId, p.lineId);
    const result = await deleteTemplateGuide(p.lineId);
    return NextResponse.json({ ok: true, revision: result.revision });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] DELETE guide error:', err);
    return NextResponse.json({ error: 'Failed to delete guide' }, { status: 500 });
  }
}

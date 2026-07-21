import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability, AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { templateLineBelongsToTemplate, getTemplateCompany } from '@/lib/odoo-tasks';
import {
  addTemplateLinePhoto,
  removeTemplateLinePhoto,
  clearTemplateLineSetupPhoto,
  getTemplateSetupPhoto,
  getSetupPhotoBySeq,
} from '@/lib/setup-guide';

export const dynamic = 'force-dynamic';

// Guard against oversized payloads (client compresses to a 1280px JPEG ~100-300KB).
const MAX_BYTES = 8 * 1024 * 1024;

function ids(params: { id: string; lineId: string }): { templateId: number; lineId: number } | null {
  const templateId = parseInt(params.id, 10);
  const lineId = parseInt(params.lineId, 10);
  if (Number.isNaN(templateId) || Number.isNaN(lineId)) return null;
  return { templateId, lineId };
}

/** The line must belong to the template AND the template's company must be allowed. */
async function assertScope(user: PortalUser, templateId: number, lineId: number): Promise<void> {
  if (!(await templateLineBelongsToTemplate(templateId, lineId))) {
    throw new AuthError('Not found', 404);
  }
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (allowed.length) {
    const company = await getTemplateCompany(templateId);
    if (company !== null && !allowed.includes(company)) throw new AuthError('Forbidden', 403);
  }
}

/** Validate the base64 payload really begins with a known raster-image signature —
 * never trust the filename/Content-Type (blocks SVG/HTML smuggling). */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function detectImageMime(base64: string): string | null {
  let head: Buffer;
  try { head = Buffer.from(base64.slice(0, 24), 'base64'); } catch { return null; }
  if (head.length < 12) return null;
  // JPEG: FF D8 FF (SOI + first marker).
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  // PNG: full 8-byte magic.
  if (head.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  // GIF: "GIF87a" / "GIF89a".
  const g = head.subarray(0, 6).toString('ascii');
  if (g === 'GIF87a' || g === 'GIF89a') return 'image/gif';
  // WEBP: "RIFF"...."WEBP".
  if (head.subarray(0, 4).toString('ascii') === 'RIFF'
      && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// GET — serve one of the template line's reference photos as raw image bytes
// (manager editor). `?seq=N` selects a photo of a multi-photo guide; default first.
export async function GET(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireAuth();
    const parsed = ids(params);
    if (!parsed) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, parsed.templateId, parsed.lineId);
    const seqRaw = req.nextUrl.searchParams.get('seq');
    const photo = seqRaw !== null && !Number.isNaN(parseInt(seqRaw, 10))
      ? await getSetupPhotoBySeq('template', parsed.lineId, parseInt(seqRaw, 10))
      : await getTemplateSetupPhoto(parsed.lineId);
    if (!photo) return NextResponse.json({ error: 'No photo' }, { status: 404 });
    const buf = Buffer.from(photo.data_base64, 'base64');
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': photo.mimetype || 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — upload/replace the reference photo. Manager/admin, company-scoped. `clear_pins` drops stale pins.
export async function POST(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireCapability('tasks.template.manage');
    const parsed = ids(params);
    if (!parsed) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, parsed.templateId, parsed.lineId);
    const body = await req.json();
    const base64: string = body?.data_base64 || '';
    if (!base64) return NextResponse.json({ error: 'data_base64 required' }, { status: 400 });
    // Rough decoded-size guard (base64 is ~4/3 of the raw bytes).
    if (base64.length * 0.75 > MAX_BYTES) {
      return NextResponse.json({ error: 'Image too large' }, { status: 413 });
    }
    // Validate real image bytes; derive the stored filename extension from the signature.
    const mime = detectImageMime(base64);
    if (!mime) return NextResponse.json({ error: 'File is not a valid image' }, { status: 415 });
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    // Append a new photo, or replace the photo at `seq` when provided.
    const seq = typeof body?.seq === 'number' ? body.seq : undefined;
    const filename = `setup-${seq ?? 'new'}.${ext}`;
    const savedSeq = await addTemplateLinePhoto(parsed.lineId, base64, filename, seq);
    return NextResponse.json({ ok: true, seq: savedSeq });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to upload photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — `?seq=N` removes ONE photo (+ any orphaned pins on it, server-side);
// without seq: legacy clear-ALL photos (optionally clearing pins). Manager/admin, company-scoped.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireCapability('tasks.template.manage');
    const parsed = ids(params);
    if (!parsed) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, parsed.templateId, parsed.lineId);
    const seqRaw = req.nextUrl.searchParams.get('seq');
    if (seqRaw !== null && !Number.isNaN(parseInt(seqRaw, 10))) {
      await removeTemplateLinePhoto(parsed.lineId, parseInt(seqRaw, 10));
      return NextResponse.json({ ok: true });
    }
    const clearPins = req.nextUrl.searchParams.get('clear_pins') === '1';
    await clearTemplateLineSetupPhoto(parsed.lineId, clearPins);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to remove photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

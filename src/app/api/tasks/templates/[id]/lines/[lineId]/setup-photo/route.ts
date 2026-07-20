import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability, AuthError } from '@/lib/auth';
import { templateLineBelongsToTemplate } from '@/lib/odoo-tasks';
import {
  setTemplateLineSetupPhoto,
  clearTemplateLineSetupPhoto,
  getTemplateSetupPhoto,
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

// GET — serve the template line's reference photo as raw image bytes (manager editor).
export async function GET(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    requireAuth();
    const parsed = ids(params);
    if (!parsed) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    if (!(await templateLineBelongsToTemplate(parsed.templateId, parsed.lineId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const photo = await getTemplateSetupPhoto(parsed.lineId);
    if (!photo) return NextResponse.json({ error: 'No photo' }, { status: 404 });
    const buf = Buffer.from(photo.data_base64, 'base64');
    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': photo.mimetype || 'image/jpeg', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — upload/replace the reference photo. Manager/admin. `clear_pins` drops stale pins.
export async function POST(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    requireCapability('tasks.template.manage');
    const parsed = ids(params);
    if (!parsed) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    if (!(await templateLineBelongsToTemplate(parsed.templateId, parsed.lineId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const base64: string = body?.data_base64 || '';
    const filename: string = (body?.filename || 'setup.jpg').toString();
    if (!base64) return NextResponse.json({ error: 'data_base64 required' }, { status: 400 });
    // Rough decoded-size guard (base64 is ~4/3 of the raw bytes).
    if (base64.length * 0.75 > MAX_BYTES) {
      return NextResponse.json({ error: 'Image too large' }, { status: 413 });
    }
    await setTemplateLineSetupPhoto(parsed.lineId, base64, filename, !!body?.clear_pins);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to upload photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — remove the reference photo (optionally clearing pins). Manager/admin.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    requireCapability('tasks.template.manage');
    const parsed = ids(params);
    if (!parsed) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    if (!(await templateLineBelongsToTemplate(parsed.templateId, parsed.lineId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

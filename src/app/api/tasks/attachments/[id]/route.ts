import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability, AuthError } from '@/lib/auth';
import { deleteAttachment, getAttachmentData } from '@/lib/odoo-tasks';

// GET — raw bytes of a task attachment, so it can be shown directly in an <img>
// (thumbnail) or served to the browser. Same auth as the /data JSON endpoint.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const data = await getAttachmentData(id);
    if (!data || !data.data_base64) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(Buffer.from(data.data_base64, 'base64'), {
      status: 200,
      headers: {
        'Content-Type': data.mimetype || 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to load attachment' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireCapability('tasks.template.manage');
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await deleteAttachment(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to delete attachment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

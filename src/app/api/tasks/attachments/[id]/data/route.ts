import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getAttachmentData } from '@/lib/odoo-tasks';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const data = await getAttachmentData(id);
    if (!data) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load attachment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

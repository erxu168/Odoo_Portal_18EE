import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { deleteAttachment } from '@/lib/odoo-tasks';

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

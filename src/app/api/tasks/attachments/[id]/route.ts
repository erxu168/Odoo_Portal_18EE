import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { deleteAttachment } from '@/lib/odoo-tasks';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('manager');
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

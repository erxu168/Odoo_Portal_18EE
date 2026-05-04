import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole, AuthError } from '@/lib/auth';
import { completeLine, uncompleteLine } from '@/lib/odoo-tasks';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireAuth();
    if (!user.employee_id) {
      return NextResponse.json({ error: 'No employee record linked' }, { status: 409 });
    }
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const result = await completeLine(id, user.employee_id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to complete task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('manager');
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await uncompleteLine(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to undo completion';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

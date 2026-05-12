import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { setLineNote } from '@/lib/odoo-tasks';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireAuth();
    if (!user.employee_id) {
      return NextResponse.json({ error: 'No employee record linked' }, { status: 409 });
    }
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const body = await req.json();
    const note = typeof body.note === 'string' ? body.note : '';
    await setLineNote(id, note, user.employee_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to save note';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

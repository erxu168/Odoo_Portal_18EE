import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { toggleSubtask } from '@/lib/odoo-tasks';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  try {
    const user = requireAuth();
    if (!user.employee_id) {
      return NextResponse.json({ error: 'No employee record linked' }, { status: 409 });
    }
    const sid = parseInt(params.sid, 10);
    if (Number.isNaN(sid)) return NextResponse.json({ error: 'Invalid subtask id' }, { status: 400 });
    const body = await req.json();
    await toggleSubtask(sid, !!body.done, user.employee_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to toggle subtask';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

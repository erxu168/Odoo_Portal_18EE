import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { resolveAttribution } from '@/lib/shift-attribution';
import { toggleSubtask } from '@/lib/odoo-tasks';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  try {
    const user = requireAuth();
    // On a shared tablet, credit the "Working as" person (PIN actor), not the
    // shared account — matches the completion route. Resolve BEFORE the
    // employee-linked check so a shared account with no own employee still works.
    const { employeeId } = resolveAttribution(user);
    if (!employeeId) {
      return NextResponse.json({ error: 'No employee record linked' }, { status: 409 });
    }
    const sid = parseInt(params.sid, 10);
    if (Number.isNaN(sid)) return NextResponse.json({ error: 'Invalid subtask id' }, { status: 400 });
    const body = await req.json();
    // The addon toggle locks the parent line and drives setup-guide auto-complete,
    // returning the resulting line state so the client can refresh.
    const result = await toggleSubtask(sid, !!body.done, employeeId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to toggle subtask';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

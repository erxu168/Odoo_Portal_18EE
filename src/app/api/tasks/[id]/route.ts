import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { toggleSubtask } from '@/lib/odoo-tasks';

interface RouteParams {
  params: { id: string };
}

// PATCH /api/tasks/[id]  — toggle a subtask
// Body: { action: 'toggle_subtask', task_line_id, subtask_id, done }
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const id = parseInt(params.id, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const body = await req.json();

    if (body.action === 'toggle_subtask') {
      await toggleSubtask(body.task_line_id, body.subtask_id, body.done);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

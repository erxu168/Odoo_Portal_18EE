import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { completeTask } from '@/lib/odoo-tasks';

interface RouteParams {
  params: { id: string };
}

// POST /api/tasks/[id]/complete
export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const taskLineId = parseInt(params.id, 10);
    if (isNaN(taskLineId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const result = await completeTask(taskLineId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to complete task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

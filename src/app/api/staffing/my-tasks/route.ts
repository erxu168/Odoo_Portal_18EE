/**
 * GET /api/staffing/my-tasks — the current employee's own pending Employee tasks
 * across open checklists. Any authenticated staff member (they tick their own).
 */
import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getMyPendingEmployeeTasks } from '@/lib/staffing-checklist-db';

export async function GET() {
  try {
    const user = requireAuth();
    if (!user.employee_id) return NextResponse.json({ tasks: [] });
    const tasks = getMyPendingEmployeeTasks(user.employee_id).map(t => ({
      id: t.id, instance_id: t.instance_id, title: t.title,
      due_date: t.due_date, reminder: t.reminder, stage: t.stage,
    }));
    return NextResponse.json({ tasks });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET my-tasks', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

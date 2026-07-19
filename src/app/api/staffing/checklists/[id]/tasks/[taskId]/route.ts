/**
 * PATCH /api/staffing/checklists/[id]/tasks/[taskId] — tick / un-tick / skip / note a task.
 *
 * Allowed for: a manager (staffing.instances.manage) in the instance's company, OR
 * the employee themselves for their own Employee-section task. Skipping is
 * manager-only. Cancelled instances reject updates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { canAccessCompany } from '@/lib/inventory-access';
import { getTaskWithInstance, setTaskStatus } from '@/lib/staffing-checklist-db';
import type { TaskStatus } from '@/types/staffing';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  try {
    const user = requireAuth();
    const found = getTaskWithInstance(Number(params.taskId));
    if (!found || found.instance.id !== Number(params.id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { task, instance } = found;
    if (instance.status === 'cancelled') {
      return NextResponse.json({ error: 'This checklist was cancelled.' }, { status: 409 });
    }

    const isManager = roleCan(user.role, 'staffing.instances.manage', getPermissionOverrides())
      && canAccessCompany(user, instance.company_id);
    const isOwnEmployeeTask = task.audience === 'employee'
      && task.assignee_employee_id != null && task.assignee_employee_id === user.employee_id;
    if (!isManager && !isOwnEmployeeTask) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const b = await req.json();
    const status = b.status as TaskStatus;
    if (!['pending', 'done', 'skipped'].includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    if (status === 'skipped' && !isManager) {
      return NextResponse.json({ error: 'Only a manager can skip a task.' }, { status: 403 });
    }

    setTaskStatus(task.id, { status, done_by: user.id, note: typeof b.note === 'string' ? b.note : null });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] PATCH checklist task', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

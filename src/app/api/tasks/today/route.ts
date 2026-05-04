import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getEmployeeContext, getTodayListForDepartment } from '@/lib/odoo-tasks';

export async function GET() {
  try {
    const user = requireAuth();
    if (!user.employee_id) {
      return NextResponse.json({
        error: 'Your account is not linked to an Odoo employee record. Ask your manager.',
        code: 'NO_EMPLOYEE',
      }, { status: 409 });
    }
    const ctx = await getEmployeeContext(user.employee_id);
    if (!ctx?.department_id) {
      return NextResponse.json({
        error: 'You are not assigned to a department. Ask your manager to set your department in HR.',
        code: 'NO_DEPARTMENT',
        context: ctx,
      }, { status: 409 });
    }
    const list = await getTodayListForDepartment(ctx.department_id);
    return NextResponse.json({ context: ctx, list });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to load list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

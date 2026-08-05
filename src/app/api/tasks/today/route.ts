import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { resolveAttribution } from '@/lib/shift-attribution';
import { getEmployeeContext, getTodayListForDepartment } from '@/lib/odoo-tasks';
import { moduleForbidden } from '@/lib/module-access';

export async function GET() {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireAuth();
    // A shared department tablet is a PLACE, not a person: it has no employee
    // record of its own. The checklist follows whoever signed in with their PIN
    // ("Working as"), exactly like ticking a task already does. Resolve BEFORE
    // the employee check so the shared account itself never needs linking.
    const { employeeId } = resolveAttribution(user);
    if (!employeeId) {
      return NextResponse.json({
        error: user.is_shared_device
          ? 'Sign in with your PIN to see your department\u2019s checklist.'
          : 'Your account is not linked to an Odoo employee record. Ask your manager.',
        code: user.is_shared_device ? 'NO_ACTOR' : 'NO_EMPLOYEE',
      }, { status: 409 });
    }
    const ctx = await getEmployeeContext(employeeId);
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

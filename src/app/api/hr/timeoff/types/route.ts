/**
 * GET /api/hr/timeoff/types?employee_id=X
 * Leave types available to an employee (global + their company), with the
 * employee's remaining balance per type. Day/half-day types only for now
 * (hour-unit types like Unpaid/Extra Hours need a separate hours flow).
 * Company-scoped: managers only their own restaurant(s).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const url = new URL(req.url);
    const employeeId = Number(url.searchParams.get('employee_id'));
    if (!employeeId) return NextResponse.json({ error: 'Missing employee_id' }, { status: 400 });

    const odoo = getOdoo();
    const emps = await odoo.searchRead('hr.employee', [['id', '=', employeeId]], ['company_id'], {
      limit: 1, context: { active_test: false },
    });
    if (!emps.length) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    const cId = Array.isArray(emps[0].company_id) ? emps[0].company_id[0] : null;

    if (user.role !== 'admin') {
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (cId === null || !allowed.includes(cId)) {
        return NextResponse.json({ error: 'You can only view your own restaurant.' }, { status: 403 });
      }
    }

    // Global types (company_id false) + the employee's company types.
    const domain: unknown[] = cId
      ? ['|', ['company_id', '=', false], ['company_id', '=', cId]]
      : [['company_id', '=', false]];
    // virtual_remaining_leaves is computed per-employee via context.
    const rows = await odoo.searchRead(
      'hr.leave.type', domain,
      ['id', 'name', 'requires_allocation', 'request_unit', 'virtual_remaining_leaves'],
      { context: { employee_id: employeeId }, limit: 100, order: 'name asc' },
    );
    const types = (rows || [])
      .filter((t: any) => t.request_unit !== 'hour')
      .map((t: any) => ({
        id: t.id,
        name: t.name,
        requires_allocation: t.requires_allocation === 'yes',
        remaining: typeof t.virtual_remaining_leaves === 'number' ? t.virtual_remaining_leaves : null,
      }));

    return NextResponse.json({ types });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/timeoff/types error:', err);
    return NextResponse.json({ error: 'Failed to load time-off types' }, { status: 500 });
  }
}

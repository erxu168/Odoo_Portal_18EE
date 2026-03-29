import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/termination/employees
 * List active employees for the termination wizard dropdown.
 * Returns: id, name, company_id, department, job_title, private address
 */
export async function GET() {
  try {
    const odoo = getOdoo();
    const employees = await odoo.searchRead(
      'hr.employee',
      [['active', '=', true]],
      [
        'id', 'name', 'company_id', 'department_id', 'job_title',
        'private_street', 'private_city', 'private_zip',
        'work_email', 'mobile_phone',
      ],
      { order: 'name asc', limit: 500 },
    );
    return NextResponse.json({ ok: true, data: employees });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

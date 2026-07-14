import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';

/**
 * GET /api/termination/employees?company_id=5
 * List active employees, optionally filtered by company.
 */
export async function GET(req: NextRequest) {
  try {
    requireRole('manager');
    const odoo = getOdoo();
    const { searchParams } = new URL(req.url);

    const domain: unknown[][] = [['active', '=', true]];
    const companyId = searchParams.get('company_id');
    if (companyId) {
      domain.push(['company_id', '=', Number(companyId)]);
    }

    const employees = await odoo.searchRead(
      'hr.employee',
      domain,
      [
        'id', 'name', 'company_id', 'department_id', 'job_title',
        'private_street', 'private_city', 'private_zip',
        'work_email', 'mobile_phone',
      ],
      { order: 'name asc', limit: 500 },
    );
    return NextResponse.json({ ok: true, data: employees });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

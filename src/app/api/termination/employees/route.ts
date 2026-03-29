import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/termination/employees?company_id=5
 * List active employees, optionally filtered by company.
 */
export async function GET(req: NextRequest) {
  try {
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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

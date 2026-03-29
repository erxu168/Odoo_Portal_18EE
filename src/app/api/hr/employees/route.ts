/**
 * GET /api/hr/employees — list employees for termination wizard picker
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const companyId = Number(url.searchParams.get('company_id') || 0);
    const search = url.searchParams.get('search') || '';

    const domain: unknown[][] = [['active', '=', true]];
    if (companyId) domain.push(['company_id', '=', companyId]);
    if (search) domain.push(['name', 'ilike', search]);

    const odoo = getOdoo();
    const records = await odoo.searchRead(
      'hr.employee',
      domain,
      ['id', 'name', 'department_id', 'job_title', 'first_contract_date', 'company_id',
       'private_street', 'private_city', 'private_zip'],
      { limit: 50, order: 'name asc' },
    );

    return NextResponse.json({ employees: records });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

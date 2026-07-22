/**
 * GET  /api/hr/termination  — list terminations
 * POST /api/hr/termination  — create new termination
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { canAccessEmployee } from '@/lib/hr-access';
import { companyScope } from '@/lib/inventory-access';
import { TERMINATION_LIST_FIELDS } from '@/types/termination';

export async function GET(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const url = new URL(req.url);
    const companyId = Number(url.searchParams.get('company_id') || 0);
    const state = url.searchParams.get('state');
    const limit = Number(url.searchParams.get('limit') || 50);
    const offset = Number(url.searchParams.get('offset') || 0);
    const search = url.searchParams.get('search') || '';

    const domain: unknown[][] = [];
    // ALWAYS scope to the caller's restaurant(s) — never list every company's
    // terminations. companyScope returns undefined only for an unrestricted admin.
    const scope = companyScope(user);
    if (scope) {
      if (companyId && scope.includes(companyId)) domain.push(['company_id', '=', companyId]);
      else domain.push(['company_id', 'in', scope]);
    } else if (companyId) {
      domain.push(['company_id', '=', companyId]);   // unrestricted admin may narrow
    }
    if (state) domain.push(['state', '=', state]);
    if (search) domain.push(['employee_name', 'ilike', search]);

    const odoo = getOdoo();
    const records = await odoo.searchRead(
      'kw.termination',
      domain,
      [...TERMINATION_LIST_FIELDS],
      { limit, offset, order: 'letter_date desc, id desc' },
    );

    const total = await odoo.call('kw.termination', 'search_count', [domain]);

    return NextResponse.json({ records, total });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/termination error:', err);
    return NextResponse.json({ error: 'Failed to fetch terminations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const body = await req.json();

    const requiredFields = ['employee_id', 'termination_type', 'letter_date', 'calc_method'];
    for (const f of requiredFields) {
      if (!body[f]) {
        return NextResponse.json({ error: `Missing required field: ${f}` }, { status: 400 });
      }
    }
    // Authorize by the target employee (their restaurant), and DERIVE company_id
    // from the employee — never trust a client-supplied company_id.
    const employeeId = Number(body.employee_id);
    if (!(await canAccessEmployee(user, employeeId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const empRow = await getOdoo().read('hr.employee', [employeeId], ['company_id']);
    const cid = empRow?.[0]?.company_id;
    const derivedCompanyId = Array.isArray(cid) ? cid[0] : typeof cid === 'number' ? cid : null;
    if (derivedCompanyId == null) {
      return NextResponse.json({ error: 'Employee has no company' }, { status: 400 });
    }

    const vals: Record<string, unknown> = {
      employee_id: employeeId,
      company_id: derivedCompanyId,
      termination_type: body.termination_type,
      letter_date: body.letter_date,
      calc_method: body.calc_method,
    };

    if (body.receipt_date) vals.receipt_date = body.receipt_date;
    if (body.resignation_method) vals.resignation_method = body.resignation_method;
    if (body.resignation_received_date) vals.resignation_received_date = body.resignation_received_date;
    if (body.garden_leave !== undefined) vals.garden_leave = body.garden_leave;
    if (body.include_severance !== undefined) vals.include_severance = body.include_severance;
    if (body.severance_amount) vals.severance_amount = body.severance_amount;
    if (body.incident_date) vals.incident_date = body.incident_date;
    if (body.incident_description) vals.incident_description = body.incident_description;

    const odoo = getOdoo();
    const id = await odoo.create('kw.termination', vals);

    return NextResponse.json({ id, success: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/termination error:', err);
    return NextResponse.json({ error: 'Failed to create termination' }, { status: 500 });
  }
}

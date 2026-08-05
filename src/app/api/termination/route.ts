import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { AuthError } from '@/lib/auth';
import { requireTerminationAccess, terminationCompanyScope } from '@/lib/termination-access';
import { canAccessCompany } from '@/lib/inventory-access';
import { moduleForbidden } from '@/lib/module-access';
import {
  TERMINATION_LIST_FIELDS,
  TERMINATION_DETAIL_FIELDS,
  type TerminationCreateValues,
} from '@/types/termination';

const MODEL = 'kw.termination';

/**
 * GET /api/termination
 * List terminations. Optional query params: state, employee_id, company_id
 */
export async function GET(req: NextRequest) {
  const denied = moduleForbidden('termination');
  if (denied) return denied;

  try {
    const user = await requireTerminationAccess();
    const odoo = getOdoo();
    const { searchParams } = new URL(req.url);

    const domain: unknown[][] = [];
    // Company scoping is authorization, not a filter preference.
    const scope = terminationCompanyScope(user);
    if (scope !== undefined) domain.push(['company_id', 'in', scope.length ? scope : [-1]]);
    const stateFilter = searchParams.get('state');
    if (stateFilter) domain.push(['state', '=', stateFilter]);
    const empId = searchParams.get('employee_id');
    if (empId) domain.push(['employee_id', '=', Number(empId)]);
    const companyId = searchParams.get('company_id');
    if (companyId) {
      if (!canAccessCompany(user, Number(companyId))) {
        return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
      }
      domain.push(['company_id', '=', Number(companyId)]);
    }

    const records = await odoo.searchRead(MODEL, domain, TERMINATION_LIST_FIELDS, {
      order: 'letter_date desc',
      limit: Number(searchParams.get('limit') || 100),
    });

    // Enrich with employee job_title and department
    const empIds = Array.from(new Set(records.map((r: any) => r.employee_id?.[0]).filter(Boolean)));
    const empMap: Record<number, { job_title: string; department: string }> = {};
    if (empIds.length > 0) {
      const employees = await odoo.searchRead('hr.employee', [['id', 'in', empIds]], ['id', 'job_title', 'department_id']);
      for (const emp of employees || []) {
        empMap[emp.id] = {
          job_title: emp.job_title || '',
          department: emp.department_id ? emp.department_id[1] : '',
        };
      }
    }
    const enriched = records.map((r: any) => ({
      ...r,
      job_title: empMap[r.employee_id?.[0]]?.job_title || '',
      department: empMap[r.employee_id?.[0]]?.department || '',
    }));

    return NextResponse.json({ ok: true, data: enriched });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/termination
 * Create a new termination record.
 * Body: TerminationCreateValues
 */
export async function POST(req: NextRequest) {
  const denied = moduleForbidden('termination');
  if (denied) return denied;

  try {
    const user = await requireTerminationAccess();
    const odoo = getOdoo();
    const body: TerminationCreateValues = await req.json();

    if (!body.employee_id || !body.termination_type) {
      return NextResponse.json(
        { ok: false, error: 'employee_id and termination_type are required' },
        { status: 400 },
      );
    }

    // Company comes from the employee record, never from the client.
    const emp = (await odoo.read('hr.employee', [Number(body.employee_id)], ['company_id']))?.[0];
    if (!emp) return NextResponse.json({ ok: false, error: 'Employee not found' }, { status: 404 });
    const empCompany = Array.isArray(emp.company_id) ? emp.company_id[0] : emp.company_id;
    if (!canAccessCompany(user, empCompany)) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    body.company_id = empCompany;

    const id = await odoo.create(MODEL, body);

    // Read back the full record with computed fields
    const records = await odoo.read(MODEL, [id], TERMINATION_DETAIL_FIELDS);

    return NextResponse.json({ ok: true, data: records[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    // Log the real cause — this catch silently ate an invalid-field crash for days.
    console.error('POST /api/termination error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

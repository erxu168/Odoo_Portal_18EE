import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
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
  try {
    const odoo = getOdoo();
    const { searchParams } = new URL(req.url);

    const domain: unknown[][] = [];
    const stateFilter = searchParams.get('state');
    if (stateFilter) domain.push(['state', '=', stateFilter]);
    const empId = searchParams.get('employee_id');
    if (empId) domain.push(['employee_id', '=', Number(empId)]);
    const companyId = searchParams.get('company_id');
    if (companyId) domain.push(['company_id', '=', Number(companyId)]);

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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/termination
 * Create a new termination record.
 * Body: TerminationCreateValues
 */
export async function POST(req: NextRequest) {
  try {
    const odoo = getOdoo();
    const body: TerminationCreateValues = await req.json();

    if (!body.employee_id || !body.termination_type) {
      return NextResponse.json(
        { ok: false, error: 'employee_id and termination_type are required' },
        { status: 400 },
      );
    }

    const id = await odoo.create(MODEL, body);

    // Read back the full record with computed fields
    const records = await odoo.read(MODEL, [id], TERMINATION_DETAIL_FIELDS);

    return NextResponse.json({ ok: true, data: records[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

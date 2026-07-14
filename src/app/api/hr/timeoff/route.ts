/**
 * GET  /api/hr/timeoff — list time-off requests (company-scoped for managers).
 *   ?status=pending|all (default pending = confirm+validate1), ?company_id=
 * POST /api/hr/timeoff — create a request on behalf of an employee.
 *
 * Odoo model hr.leave. Requests are created in state 'confirm' (pending).
 * Company scoping mirrors the employee routes; approval permission is enforced
 * in the [id]/decision route. The portal Odoo user (uid 2) can act on any leave,
 * so the portal — not Odoo — decides who may see/act.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

const LIST_FIELDS = ['id', 'employee_id', 'holiday_status_id', 'request_date_from', 'request_date_to',
  'number_of_days', 'state', 'company_id', 'department_id'];

export async function GET(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'pending';
    const companyId = Number(url.searchParams.get('company_id') || 0);

    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed && allowed.length === 0) return NextResponse.json({ leaves: [] });

    const domain: unknown[][] = [];
    if (status === 'pending') domain.push(['state', 'in', ['confirm', 'validate1']]);
    if (allowed) domain.push(['company_id', 'in', allowed]);
    if (companyId) {
      if (allowed && !allowed.includes(companyId)) {
        return NextResponse.json({ error: 'Not allowed for this restaurant' }, { status: 403 });
      }
      domain.push(['company_id', '=', companyId]);
    }

    const odoo = getOdoo();
    const rows = await odoo.searchRead('hr.leave', domain, LIST_FIELDS, {
      limit: 200, order: 'request_date_from desc, id desc',
    });
    const isAdmin = user.role === 'admin';
    const leaves = (rows || []).map((r: any) => {
      const cId = Array.isArray(r.company_id) ? r.company_id[0] : null;
      const canAct = ['confirm', 'validate1'].includes(r.state)
        && (isAdmin || (cId !== null && !!allowed && allowed.includes(cId)));
      return {
        id: r.id,
        employee_id: Array.isArray(r.employee_id) ? r.employee_id[0] : null,
        employee_name: Array.isArray(r.employee_id) ? r.employee_id[1] : '',
        type: Array.isArray(r.holiday_status_id) ? r.holiday_status_id[1] : '',
        date_from: r.request_date_from || '',
        date_to: r.request_date_to || '',
        days: r.number_of_days || 0,
        state: r.state,
        company_id: cId,
        company_name: Array.isArray(r.company_id) ? r.company_id[1] : '',
        department: Array.isArray(r.department_id) ? r.department_id[1] : '',
        can_act: canAct,
      };
    });
    return NextResponse.json({ leaves });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/timeoff error:', err);
    return NextResponse.json({ error: 'Failed to load time off' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const body = await req.json();

    const employeeId = Number(body.employee_id);
    const typeId = Number(body.holiday_status_id);
    const from = String(body.request_date_from || '').trim();
    const to = String(body.request_date_to || '').trim();
    if (!employeeId) return NextResponse.json({ error: 'Please choose a staff member.' }, { status: 400 });
    if (!typeId) return NextResponse.json({ error: 'Please choose a time-off type.' }, { status: 400 });
    if (!from || !to) return NextResponse.json({ error: 'Please choose the dates.' }, { status: 400 });
    if (to < from) return NextResponse.json({ error: 'The end date is before the start date.' }, { status: 400 });

    const odoo = getOdoo();
    const emps = await odoo.searchRead('hr.employee', [['id', '=', employeeId]], ['company_id'], {
      limit: 1, context: { active_test: false },
    });
    if (!emps.length) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    const cId = Array.isArray(emps[0].company_id) ? emps[0].company_id[0] : null;

    if (user.role !== 'admin') {
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (cId === null || !allowed.includes(cId)) {
        return NextResponse.json({ error: 'You can only book time off for your own restaurant.' }, { status: 403 });
      }
    }

    const vals: Record<string, unknown> = {
      employee_id: employeeId,
      holiday_status_id: typeId,
      request_date_from: from,
      request_date_to: to,
    };
    if (body.reason) vals.private_name = String(body.reason).trim();

    const id = await odoo.create('hr.leave', vals);
    return NextResponse.json({ leave: { id } }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/timeoff error:', err);
    // Odoo raises readable messages here (e.g. not enough allocation) — pass it through.
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create request' }, { status: 500 });
  }
}

/**
 * GET  /api/hr/jobs — list job positions / roles (company-scoped for managers), with staff counts.
 * POST /api/hr/jobs — create a role (managers: own restaurant only).
 *
 * "Roles" in the portal == hr.job. Company scoping mirrors /api/hr/employees.
 * Removal is archiving (PATCH active:false); we never hard-delete.
 * Legacy global (company-less) roles are visible to admins only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

const LIST_FIELDS = ['id', 'name', 'company_id', 'department_id', 'active', 'no_of_employee'];

export async function GET(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get('include_archived') === '1';
    const companyId = Number(url.searchParams.get('company_id') || 0);

    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed && allowed.length === 0) return NextResponse.json({ jobs: [] });

    const domain: unknown[][] = [];
    if (!includeArchived) domain.push(['active', '=', true]);
    if (allowed) domain.push(['company_id', 'in', allowed]); // managers: own restaurants only (excludes global)
    if (companyId) {
      if (allowed && !allowed.includes(companyId)) {
        return NextResponse.json({ error: 'Not allowed for this restaurant' }, { status: 403 });
      }
      domain.push(['company_id', '=', companyId]);
    }

    const odoo = getOdoo();
    const records = await odoo.searchRead('hr.job', domain, LIST_FIELDS, {
      limit: 200, order: 'name asc', context: { active_test: false },
    });
    const jobs = (records || []).map((j: any) => ({
      id: j.id,
      name: j.name,
      company_id: Array.isArray(j.company_id) ? j.company_id[0] : null,
      company_name: Array.isArray(j.company_id) ? j.company_id[1] : '',
      department_id: Array.isArray(j.department_id) ? j.department_id[0] : null,
      department_name: Array.isArray(j.department_id) ? j.department_id[1] : '',
      no_of_employee: j.no_of_employee || 0,
      active: j.active !== false,
    }));
    return NextResponse.json({ jobs });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/jobs error:', err);
    return NextResponse.json({ error: 'Failed to fetch roles' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const body = await req.json();

    const name = String(body.name || '').trim();
    const companyId = Number(body.company_id);
    if (!name) return NextResponse.json({ error: 'Please enter a role name.' }, { status: 400 });
    if (!companyId) return NextResponse.json({ error: 'Please choose a restaurant.' }, { status: 400 });

    // Managers may only add to their own restaurant(s).
    if (user.role !== 'admin') {
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (!allowed.includes(companyId)) {
        return NextResponse.json({ error: 'You can only add roles to your own restaurant.' }, { status: 403 });
      }
    }

    const vals: Record<string, unknown> = { name, company_id: companyId };
    if (body.department_id) vals.department_id = Number(body.department_id);

    const odoo = getOdoo();
    const id = await odoo.create('hr.job', vals);
    return NextResponse.json({ job: { id, name } }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/jobs error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create role' }, { status: 500 });
  }
}

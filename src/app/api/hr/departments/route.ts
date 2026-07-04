/**
 * GET  /api/hr/departments — list departments (company-scoped for managers), with staff counts.
 * POST /api/hr/departments — create a department (managers: own restaurant only).
 *
 * Company scoping mirrors /api/hr/employees. Removal is done by archiving
 * (PATCH active:false) — hr.department is DB-protected against delete when it
 * still has staff, so we never hard-delete here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

const LIST_FIELDS = ['id', 'name', 'company_id', 'active', 'total_employee'];

export async function GET(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get('include_archived') === '1';
    const companyId = Number(url.searchParams.get('company_id') || 0);

    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed && allowed.length === 0) return NextResponse.json({ departments: [] });

    const domain: unknown[][] = [];
    if (!includeArchived) domain.push(['active', '=', true]);
    if (allowed) domain.push(['company_id', 'in', allowed]);
    if (companyId) {
      if (allowed && !allowed.includes(companyId)) {
        return NextResponse.json({ error: 'Not allowed for this restaurant' }, { status: 403 });
      }
      domain.push(['company_id', '=', companyId]);
    }

    const odoo = getOdoo();
    const records = await odoo.searchRead('hr.department', domain, LIST_FIELDS, {
      limit: 200, order: 'name asc', context: { active_test: false },
    });
    const departments = (records || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      company_id: Array.isArray(d.company_id) ? d.company_id[0] : null,
      company_name: Array.isArray(d.company_id) ? d.company_id[1] : '',
      total_employee: d.total_employee || 0,
      active: d.active !== false,
    }));
    return NextResponse.json({ departments });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/departments error:', err);
    return NextResponse.json({ error: 'Failed to fetch departments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const body = await req.json();

    const name = String(body.name || '').trim();
    const companyId = Number(body.company_id);
    if (!name) return NextResponse.json({ error: 'Please enter a department name.' }, { status: 400 });
    if (!companyId) return NextResponse.json({ error: 'Please choose a restaurant.' }, { status: 400 });

    // Managers may only add to their own restaurant(s).
    if (user.role !== 'admin') {
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (!allowed.includes(companyId)) {
        return NextResponse.json({ error: 'You can only add departments to your own restaurant.' }, { status: 403 });
      }
    }

    const odoo = getOdoo();
    const id = await odoo.create('hr.department', { name, company_id: companyId });
    return NextResponse.json({ department: { id, name } }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/departments error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create department' }, { status: 500 });
  }
}

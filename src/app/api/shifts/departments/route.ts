/**
 * GET  /api/shifts/departments?company_id=   — list this company's departments.
 * POST /api/shifts/departments {company_id, name} — create a company department.
 *
 * Manager-only. Shared departments (company_id = false) are read but managed in Odoo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchDepartments } from '@/lib/shifts-odoo';
import { getOdoo } from '@/lib/odoo';
import { requireManagerCompany, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    return NextResponse.json({ departments: await fetchDepartments(auth.companyId) });
  } catch (err: unknown) {
    return serverError('GET departments', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'A department name is required' }, { status: 400 });
    const id = (await getOdoo().create('hr.department', {
      name,
      company_id: auth.companyId,
    })) as number;
    return NextResponse.json({ ok: true, id, name });
  } catch (err: unknown) {
    return serverError('POST departments', err);
  }
}

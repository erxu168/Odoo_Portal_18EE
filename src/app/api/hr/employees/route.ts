/**
 * GET  /api/hr/employees — list staff (company-scoped for managers).
 * POST /api/hr/employees — create a staff member (managers: own company only).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

const LIST_FIELDS = [
  'id', 'name', 'department_id', 'job_title', 'first_contract_date', 'company_id',
  'work_email', 'mobile_phone', 'work_phone', 'private_street', 'private_city', 'private_zip',
];

export async function GET(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const url = new URL(req.url);
    const companyId = Number(url.searchParams.get('company_id') || 0);
    const search = url.searchParams.get('search') || '';

    const domain: unknown[][] = [['active', '=', true]];

    // Company scoping: admins see all; managers only their own restaurant(s).
    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed) {
      if (allowed.length === 0) return NextResponse.json({ employees: [] });
      domain.push(['company_id', 'in', allowed]);
    }
    if (companyId) {
      if (allowed && !allowed.includes(companyId)) {
        return NextResponse.json({ error: 'Not allowed for this restaurant' }, { status: 403 });
      }
      domain.push(['company_id', '=', companyId]);
    }
    if (search) domain.push(['name', 'ilike', search]);

    const odoo = getOdoo();
    const records = await odoo.searchRead('hr.employee', domain, LIST_FIELDS, { limit: 200, order: 'name asc' });
    return NextResponse.json({ employees: records });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/employees error:', err);
    return NextResponse.json({ error: 'Failed to fetch employees' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const body = await req.json();

    const name = String(body.name || '').trim();
    const companyId = Number(body.company_id);
    const departmentId = Number(body.department_id);
    if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
    if (!companyId) return NextResponse.json({ error: 'Please choose a restaurant.' }, { status: 400 });
    if (!departmentId) return NextResponse.json({ error: 'Please choose a department.' }, { status: 400 });

    // Managers may only add to their own restaurant(s).
    if (user.role !== 'admin') {
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (!allowed.includes(companyId)) {
        return NextResponse.json({ error: 'You can only add staff to your own restaurant.' }, { status: 403 });
      }
    }

    const vals: Record<string, unknown> = { name, company_id: companyId, department_id: departmentId };
    if (body.job_title) vals.job_title = String(body.job_title).trim();
    if (body.work_email) vals.work_email = String(body.work_email).trim();
    if (body.mobile_phone) vals.mobile_phone = String(body.mobile_phone).trim();
    // Skill level ('1' | '2' | '3', higher = more senior) — decides which
    // open shifts this person can pick up. Set at creation; editable in Roster.
    if (body.skill === '1' || body.skill === '2' || body.skill === '3') {
      vals.x_skill_level = body.skill;
    }

    const odoo = getOdoo();
    const id = await odoo.create('hr.employee', vals);

    // Work phone. Standard Odoo auto-fills work_phone from the work address, which
    // defaults to the company contact — so every employee ends up showing the
    // restaurant landline. Our staff have no individual work phones unless one is
    // explicitly entered here. Write it AFTER create (separate call): address_id is
    // unchanged by this write, so the stored compute that would re-fill the company
    // landline does not run and our value sticks. Empty -> false clears the
    // auto-filled landline; a real number is saved and stays in sync with Odoo
    // (both portal and Odoo read/write this same field).
    const workPhone = String(body.work_phone || '').trim();
    await odoo.write('hr.employee', [id], { work_phone: workPhone || false });

    return NextResponse.json({ employee: { id, name } }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/employees error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create employee' }, { status: 500 });
  }
}

/**
 * PUT    /api/shifts/departments/[id] {company_id, name} — rename a department.
 * DELETE /api/shifts/departments/[id]?company_id=        — delete it (blocked if used).
 *
 * Only company-owned departments can be changed; shared ones are managed in
 * Odoo. Delete is refused while any employee is still in the department.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { countSlotsUsingDepartment } from '@/lib/shifts-db';
import { requireManagerCompany, serverError } from '../../_manager';

export const dynamic = 'force-dynamic';

type OdooRow = Record<string, unknown>;
function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}

/** null when the department is owned by the company; otherwise the error response. */
async function ownedDept(companyId: number, id: number): Promise<NextResponse | null> {
  const rows = (await getOdoo().searchRead('hr.department', [['id', '=', id]], ['company_id'], {
    limit: 1,
  })) as OdooRow[];
  if (rows.length === 0) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
  if (m2oId(rows[0].company_id) !== companyId) {
    return NextResponse.json(
      { error: 'This is a shared department — it can only be changed in Odoo.' },
      { status: 403 },
    );
  }
  return null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const id = parseInt(params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid department id' }, { status: 400 });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'A department name is required' }, { status: 400 });
    const err = await ownedDept(auth.companyId, id);
    if (err) return err;
    await getOdoo().write('hr.department', [id], { name });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('PUT departments/[id]', err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const id = parseInt(params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid department id' }, { status: 400 });
    const err = await ownedDept(auth.companyId, id);
    if (err) return err;

    const used = (await getOdoo().searchRead('hr.employee', [['department_id', '=', id]], ['id'], {
      limit: 200,
    })) as OdooRow[];
    if (used.length > 0) {
      const n = used.length === 200 ? '200+' : String(used.length);
      return NextResponse.json(
        { error: `${n} staff member${used.length === 1 ? ' is' : 's are'} in this department. Move them first.` },
        { status: 409 },
      );
    }
    // Also block while any shift is tagged with this department (open shifts have
    // no employee, so the check above misses them) — avoids dangling overrides.
    const onShifts = countSlotsUsingDepartment(auth.companyId, id);
    if (onShifts > 0) {
      return NextResponse.json(
        { error: `This department is on ${onShifts} shift${onShifts === 1 ? '' : 's'}. Change those first.` },
        { status: 409 },
      );
    }
    await getOdoo().unlink('hr.department', [id]);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('DELETE departments/[id]', err);
  }
}

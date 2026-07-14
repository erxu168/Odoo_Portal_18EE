/**
 * PUT    /api/shifts/roles/[id] {company_id, name} — rename a company role.
 * DELETE /api/shifts/roles/[id]?company_id=        — delete it (blocked if used).
 *
 * Only roles owned by this company (company_id = companyId) can be changed;
 * shared roles are managed in Odoo. Delete is refused while any planning.slot
 * still uses the role.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireManagerCompany, serverError } from '../../_manager';

export const dynamic = 'force-dynamic';

type OdooRow = Record<string, unknown>;
function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}

/** null when the role is owned by the company; otherwise the error response. */
async function ownedRole(companyId: number, id: number): Promise<NextResponse | null> {
  const rows = (await getOdoo().searchRead('planning.role', [['id', '=', id]], ['company_id'], {
    limit: 1,
  })) as OdooRow[];
  if (rows.length === 0) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  if (m2oId(rows[0].company_id) !== companyId) {
    return NextResponse.json(
      { error: 'This is a shared role — it can only be changed in Odoo.' },
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
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid role id' }, { status: 400 });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'A role name is required' }, { status: 400 });
    const err = await ownedRole(auth.companyId, id);
    if (err) return err;
    await getOdoo().write('planning.role', [id], { name });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('PUT roles/[id]', err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const id = parseInt(params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid role id' }, { status: 400 });
    const err = await ownedRole(auth.companyId, id);
    if (err) return err;

    const used = (await getOdoo().searchRead('planning.slot', [['role_id', '=', id]], ['id'], {
      limit: 200,
    })) as OdooRow[];
    if (used.length > 0) {
      const n = used.length === 200 ? '200+' : String(used.length);
      return NextResponse.json(
        { error: `This role is on ${n} shift${used.length === 1 ? '' : 's'}. Change or delete those first.` },
        { status: 409 },
      );
    }
    await getOdoo().unlink('planning.role', [id]);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('DELETE roles/[id]', err);
  }
}

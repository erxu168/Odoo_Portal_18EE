import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = getCurrentUser();
  if (!user || !hasRole(user, 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const body = await request.json();
    const vals: Record<string, any> = {};
    if (body.username !== undefined) vals.username = body.username;
    if (body.password !== undefined) vals.password = body.password;
    if (body.website_url !== undefined) vals.website_url = body.website_url;
    if (body.notes !== undefined) vals.notes = body.notes;
    if (body.company_id !== undefined) vals.company_id = body.company_id;
    if (body.partner_id !== undefined) vals.partner_id = body.partner_id;

    if (Object.keys(vals).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const odoo = getOdoo();
    await odoo.write('krawings.supplier.login', [id], vals);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[credentials] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = getCurrentUser();
  if (!user || !hasRole(user, 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const odoo = getOdoo();
    await odoo.unlink('krawings.supplier.login', [id]);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[credentials] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

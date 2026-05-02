import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { getCurrentUser, hasRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }
    if (!hasRole(user, 'manager')) {
      return NextResponse.json({ ok: false, error: 'Only managers can archive recipes' }, { status: 403 });
    }

    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid BOM id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'Body must include active: boolean' }, { status: 400 });
    }

    const odoo = getOdoo();
    await odoo.write('mrp.bom', [id], { active: body.active });

    return NextResponse.json({ ok: true, id, active: body.active });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('PATCH /api/boms/[id]/archive error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

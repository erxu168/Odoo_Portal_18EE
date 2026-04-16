import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/workcenters
 * List all active workcenters.
 */
export async function GET() {
  try {
    const odoo = getOdoo();
    const wcs = await odoo.searchRead(
      'mrp.workcenter',
      [['active', '=', true]],
      ['id', 'name'],
      { order: 'name asc' },
    );
    return NextResponse.json({ ok: true, workcenters: wcs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/workcenters
 * Create a new workcenter.  Body: { name: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = (body.name || '').trim();
    if (!name) {
      return NextResponse.json({ ok: false, error: 'Name is required' }, { status: 400 });
    }

    const odoo = getOdoo();
    const vals: Record<string, unknown> = { name };
    if (body.company_id) vals.company_id = body.company_id;
    const id = await odoo.create('mrp.workcenter', vals);
    return NextResponse.json({ ok: true, workcenter: { id, name } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

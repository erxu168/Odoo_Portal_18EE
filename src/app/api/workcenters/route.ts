import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

/**
 * GET /api/workcenters
 * List all active workcenters.
 */
export async function GET() {
  try {
    requireAuth();
    const odoo = getOdoo();
    const wcs = await odoo.searchRead(
      'mrp.workcenter',
      [['active', '=', true]],
      ['id', 'name'],
      { order: 'name asc' },
    );
    return NextResponse.json({ ok: true, workcenters: wcs });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/workcenters error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to fetch workcenters' }, { status: 500 });
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

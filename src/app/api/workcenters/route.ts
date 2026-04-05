import { NextResponse } from 'next/server';
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

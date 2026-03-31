import { NextResponse } from 'next/server';
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

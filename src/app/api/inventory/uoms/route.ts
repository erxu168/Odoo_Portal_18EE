export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/uoms
 *
 * Returns all active units of measure from Odoo for use in the
 * draft-product review panel.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    const uoms = await odoo.searchRead(
      'uom.uom',
      [['active', '=', true]],
      ['id', 'name', 'category_id'],
      { limit: 200, order: 'name' },
    );
    return NextResponse.json({ uoms });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

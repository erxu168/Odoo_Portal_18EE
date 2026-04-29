/**
 * GET /api/products/[id]/shelf-life
 * Returns chilled_days and frozen_days for the given product.template id.
 *
 * PATCH /api/products/[id]/shelf-life
 * Updates one or both values. Manager+ only.
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, hasRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tmplId = parseInt(params.id, 10);
  if (!Number.isFinite(tmplId) || tmplId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    const rows = await odoo.read('product.template', [tmplId], [
      'x_shelf_life_chilled_days',
      'x_shelf_life_frozen_days',
    ]);
    if (!rows.length) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({
      chilled_days: rows[0].x_shelf_life_chilled_days || 0,
      frozen_days: rows[0].x_shelf_life_frozen_days || 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to read shelf life';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

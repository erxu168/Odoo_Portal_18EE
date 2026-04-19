export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/products/[id]/approve
 *
 * Activates a draft product with final name/category/UOM.
 * Body: { name: string, categ_id: number, uom_id: number }
 * Manager+ only.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.id, 10);
  if (isNaN(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    const categId = Number(body.categ_id);
    const uomId = Number(body.uom_id);

    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    if (!categId || !uomId) {
      return NextResponse.json({ error: 'categ_id and uom_id required' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Validate the target product exists
    const existing = await odoo.searchRead(
      'product.product',
      [['id', '=', productId]],
      ['id', 'active'],
      { limit: 1, context: { active_test: false } },
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Validate category and UOM exist
    const categ = await odoo.searchRead('product.category', [['id', '=', categId]], ['id'], { limit: 1 });
    if (categ.length === 0) {
      return NextResponse.json({ error: 'Invalid categ_id' }, { status: 400 });
    }
    const uom = await odoo.searchRead('uom.uom', [['id', '=', uomId]], ['id'], { limit: 1 });
    if (uom.length === 0) {
      return NextResponse.json({ error: 'Invalid uom_id' }, { status: 400 });
    }

    await odoo.write('product.product', [productId], {
      name,
      categ_id: categId,
      uom_id: uomId,
      uom_po_id: uomId,
      active: true,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/approve POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

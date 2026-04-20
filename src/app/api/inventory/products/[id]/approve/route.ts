export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/products/[id]/approve
 *
 * Activates a draft product with final name/category/UOM, plus optional
 * standard_price (cost) and a vendor link (creates a product.supplierinfo
 * row if vendor_id is provided).
 *
 * Body: {
 *   name: string,
 *   categ_id: number,
 *   uom_id: number,
 *   cost?: number,            // standard_price on product.product
 *   vendor_id?: number,       // res.partner id (supplier)
 * }
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
    const cost = body.cost != null && body.cost !== '' ? Number(body.cost) : null;
    const vendorId = body.vendor_id != null && body.vendor_id !== ''
      ? Number(body.vendor_id)
      : null;

    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    if (!categId || !uomId) {
      return NextResponse.json({ error: 'categ_id and uom_id required' }, { status: 400 });
    }
    if (cost !== null && (isNaN(cost) || cost < 0)) {
      return NextResponse.json({ error: 'cost must be a non-negative number' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Validate the target product exists
    const existing = await odoo.searchRead(
      'product.product',
      [['id', '=', productId]],
      ['id', 'active', 'product_tmpl_id'],
      { limit: 1, context: { active_test: false } },
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    const templateId = Array.isArray(existing[0].product_tmpl_id)
      ? existing[0].product_tmpl_id[0]
      : existing[0].product_tmpl_id;

    // Validate category + UOM
    const categ = await odoo.searchRead('product.category', [['id', '=', categId]], ['id'], { limit: 1 });
    if (categ.length === 0) {
      return NextResponse.json({ error: 'Invalid categ_id' }, { status: 400 });
    }
    const uom = await odoo.searchRead('uom.uom', [['id', '=', uomId]], ['id'], { limit: 1 });
    if (uom.length === 0) {
      return NextResponse.json({ error: 'Invalid uom_id' }, { status: 400 });
    }

    // Validate vendor if provided
    if (vendorId !== null) {
      const vendor = await odoo.searchRead(
        'res.partner',
        [['id', '=', vendorId], ['supplier_rank', '>', 0]],
        ['id'],
        { limit: 1 },
      );
      if (vendor.length === 0) {
        return NextResponse.json({ error: 'Invalid vendor_id' }, { status: 400 });
      }
    }

    // Apply core fields. standard_price goes on product.product if provided.
    const writeVals: Record<string, any> = {
      name,
      categ_id: categId,
      uom_id: uomId,
      uom_po_id: uomId,
      active: true,
    };
    if (cost !== null) writeVals.standard_price = cost;
    await odoo.write('product.product', [productId], writeVals);

    // Create a supplier info row linking the vendor to the product.
    // product.supplierinfo.product_tmpl_id is the template; price is cost.
    if (vendorId !== null && templateId) {
      await odoo.create('product.supplierinfo', {
        partner_id: vendorId,
        product_tmpl_id: templateId,
        price: cost !== null ? cost : 0,
        min_qty: 0,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/approve POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

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
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, isDraftProduct, markDraftStatus } from '@/lib/inventory-db';
import { buildDraftApprovalVals } from '@/lib/product-create';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.draft.review', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  initInventoryTables();

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
    // Only a PENDING portal draft may be approved — never an already-active
    // product. This endpoint rewrites name/category/UOM/cost and activates, so it
    // must not be usable to overwrite an arbitrary live Odoo product by id.
    if (existing[0].active !== false) {
      return NextResponse.json({ error: 'That product is already active — only pending draft products can be approved.' }, { status: 400 });
    }
    if (!isDraftProduct(productId)) {
      return NextResponse.json({ error: 'That is not a pending draft product.' }, { status: 400 });
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

    // ORDER MATTERS. The supplier row is written FIRST, and the product is only
    // activated and marked approved once it has succeeded.
    //
    // It used to run the other way: activate, mark approved, then create the
    // supplier. A supplier failure then returned a 500 to a manager whose product
    // was already live and already gone from the review queue — so the error said
    // "it failed" while the work was half done and no longer reachable. This way
    // a supplier failure leaves the draft exactly as it was, and the manager can
    // simply try again.
    //
    // The remaining risk is inverted and much smaller: if the activation below
    // fails after the supplier row is written, a vendor price sits on a product
    // still awaiting review. The write is an upsert keyed on (template, vendor),
    // so retrying corrects it rather than stacking rows.
    if (vendorId !== null && templateId) {
      // Upsert, not create. If the supplier row succeeds and the activation
      // below fails, the draft stays pending and the manager retries — and a
      // plain create would add a second row every time, or leave a stale price
      // behind if they corrected the cost. Nothing in the review screen shows
      // these rows, so nobody would ever see the pile.
      const existingLink = await odoo.searchRead('product.supplierinfo',
        [['product_tmpl_id', '=', templateId], ['partner_id', '=', vendorId]],
        ['id'], { limit: 1 });
      const linkVals = { price: cost !== null ? cost : 0, min_qty: 0 };
      if (existingLink.length > 0) {
        await odoo.write('product.supplierinfo', [existingLink[0].id as number], linkVals);
      } else {
        await odoo.create('product.supplierinfo', {
          partner_id: vendorId, product_tmpl_id: templateId, ...linkVals,
        });
      }
    }

    // is_storable is set here too (see lib/product-create.ts): a scanned product
    // is something on a shelf, and approving it without this produced a product
    // that could never take the count it was scanned for.
    await odoo.write('product.product', [productId],
      buildDraftApprovalVals({ name, uomId, categId, cost }));
    markDraftStatus(productId, 'approved');

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/approve POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

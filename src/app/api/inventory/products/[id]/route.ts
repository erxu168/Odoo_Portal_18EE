export const dynamic = 'force-dynamic';
/**
 * PUT /api/inventory/products/[id] — edit a product's master data (portal →
 * Odoo write): name and/or unit of measure. Manager+ (product settings).
 *
 * Body: { name?: string, uom_id?: number }
 * Odoo can refuse a UoM change (different category with existing documents) —
 * that error is surfaced verbatim as a 400, never swallowed.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.id, 10);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  const body = await request.json();
  const vals: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    if (name.length > 200) return NextResponse.json({ error: 'Keep the name under 200 characters' }, { status: 400 });
    vals.name = name;
  }
  if (body.uom_id !== undefined) {
    const uomId = Number(body.uom_id);
    if (!Number.isInteger(uomId) || uomId <= 0) {
      return NextResponse.json({ error: 'Invalid unit of measure' }, { status: 400 });
    }
    vals.uom_id = uomId;
    // uom_po_id (purchase unit) is set below ONLY when the unit family changes —
    // a same-family change must not destroy e.g. "stock in Units, buy in boxes".
  }
  if (body.categ_id !== undefined) {
    const catId = Number(body.categ_id);
    if (!Number.isInteger(catId) || catId <= 0) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    vals.categ_id = catId;
  }
  if (body.barcode !== undefined) {
    const bc = String(body.barcode).trim();
    if (bc.length > 64) return NextResponse.json({ error: 'Barcode too long' }, { status: 400 });
    vals.barcode = bc === '' ? false : bc;   // Odoo: false clears the barcode
  }
  if (Object.keys(vals).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    // Product must exist (drafts included — active_test off).
    const rows = await odoo.searchRead('product.product', [['id', '=', productId]], ['id'],
      { limit: 1, context: { active_test: false } });
    if (rows.length === 0) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    if (vals.uom_id) {
      const uom = await odoo.searchRead('uom.uom', [['id', '=', vals.uom_id as number], ['active', '=', true]], ['id', 'category_id'], { limit: 1 });
      if (uom.length === 0) return NextResponse.json({ error: 'That unit no longer exists' }, { status: 400 });
      // Compare unit FAMILIES (uom.category): same family → keep the purchase
      // unit as-is; different family → the old purchase unit becomes invalid in
      // Odoo, so realign it to the new base unit.
      const curr = await odoo.searchRead('product.product', [['id', '=', productId]],
        ['uom_id'], { limit: 1, context: { active_test: false } });
      const currUomId = Array.isArray(curr[0]?.uom_id) ? curr[0].uom_id[0] : null;
      if (currUomId) {
        const currUom = await odoo.searchRead('uom.uom', [['id', '=', currUomId]], ['category_id'], { limit: 1 });
        const catOf = (r: any) => (Array.isArray(r?.category_id) ? r.category_id[0] : r?.category_id);
        if (currUom.length > 0 && catOf(uom[0]) !== catOf(currUom[0])) {
          vals.uom_po_id = vals.uom_id;
        }
      }
    }
    await odoo.write('product.product', [productId], vals);
    return NextResponse.json({ message: 'Product updated' });
  } catch (err: unknown) {
    // Odoo's own validation (e.g. UoM category change on a used product) —
    // show its reason so the manager knows WHY it was refused.
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products PUT]', msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

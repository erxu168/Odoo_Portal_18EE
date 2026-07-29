/**
 * POST /api/purchase/products/create
 * Create a NEW orderable product in Odoo (manager+), then return it in the same
 * shape as GET /api/purchase/products so the caller can drop it straight into an
 * order guide. Mirrors the inventory scan-to-create flow, but marks the product
 * active + purchase_ok and sets the chosen unit / price / category.
 *
 * Body: { name, uom_id, price?, categ_id? }
 * Products are company-agnostic (no company_id), like the inventory create flow.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { buildProductVals } from '@/lib/product-create';
import { recordPortalCreatedProduct, initInventoryTables } from '@/lib/inventory-db';
import { invalidateRelevance } from '@/lib/relevance-cache';

/**
 * A category for the rare caller that sends none.
 *
 * Odoo requires the field, and this route used to leave it unset and let Odoo
 * fill it. That is honestly all this restores — the lowest id is usually Odoo's
 * built-in "All", so this does NOT guarantee a useful category, it only
 * guarantees the create does not fail. The order-guide UI always sends one, so
 * this is a fallback rather than a path anyone travels; a product that lands in
 * "All" shows up under "No category" in Products, where it can be fixed.
 */
let _fallbackCategId: number | null = null;
async function defaultCategId(): Promise<number> {
  if (_fallbackCategId) return _fallbackCategId;
  const rows = await getOdoo().searchRead('product.category', [], ['id'], { limit: 1, order: 'id asc' });
  _fallbackCategId = (rows[0]?.id as number) || 1;
  return _fallbackCategId;
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.product.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const uomId = Number(body.uom_id);
  const categId = Number(body.categ_id);
  const price = typeof body.price === 'number' && isFinite(body.price) && body.price >= 0 ? body.price : 0;
  const defaultCode = typeof body.default_code === 'string' ? body.default_code.trim() : '';

  if (!name) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
  if (!Number.isInteger(uomId) || uomId <= 0) return NextResponse.json({ error: 'A unit is required' }, { status: 400 });

  try {
    const odoo = getOdoo();
    // The price entered here is what the SUPPLIER charges, so it is the cost and
    // only the cost. This route used to write it into list_price as well — the
    // price a CUSTOMER pays — so adding a case of soy sauce to an order guide
    // also told the till to sell it for the price of the case. Two different
    // facts, and only one of them was ever asked for.
    const vals: Record<string, any> = {
      ...buildProductVals({
        name,
        uomId,
        categId: Number.isInteger(categId) && categId > 0 ? categId : await defaultCategId(),
        defaultCode,
        cost: price,
      }),
      // Purchase-specific and deliberate: something added while building an
      // order is bought, not sold.
      purchase_ok: true,
      sale_ok: false,
    };

    const newId = await odoo.create('product.product', vals);
    // Same reason as the catalog create: Products only lists what the restaurant
    // already uses, so without this the product is invisible there until it
    // reaches a real order.
    try {
      initInventoryTables();
      recordPortalCreatedProduct(newId, user.id);
      invalidateRelevance();
    } catch (e) {
      console.error('[purchase/products/create] created', newId, 'but could not mark it visible:', e);
    }
    const rows = await odoo.read('product.product', [newId], ['id', 'name', 'uom_id', 'categ_id', 'list_price', 'default_code']);
    const p: any = rows[0] || {};
    return NextResponse.json(
      {
        product: {
          id: newId,
          name: p.name || name,
          uom: p.uom_id?.[1] || 'Units',
          // The COST that was entered, not Odoo's list_price.
          //
          // This read p.list_price, which worked only because the create wrote
          // the cost into list_price as well. With that (wrong) write removed,
          // Odoo supplies its own default sales price of 1.0 — and the caller
          // saves this straight into the order guide, so a €24.90 cost became
          // €1.00. Returning the validated input is both correct and immune to
          // whatever Odoo defaults list_price to.
          price,
          category_name: p.categ_id?.[1]?.split(' / ').pop() || 'Other',
          product_code: (typeof p.default_code === 'string' ? p.default_code : '') || defaultCode || '',
        },
      },
      { status: 201 },
    );
  } catch (e: unknown) {
    console.error('[purchase/products/create] Odoo create failed', e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Failed to create product in Odoo', detail }, { status: 502 });
  }
}

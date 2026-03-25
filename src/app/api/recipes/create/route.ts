/**
 * POST /api/recipes/create
 *
 * Creates a new dish in Odoo immediately (all roles).
 * - Cooking guide: creates product.template
 * - Production guide: creates product.template + mrp.bom
 * Staff-created dishes start unpublished; only manager/admin can publish.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { name, mode, category_id, base_servings } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!mode || !['cooking_guide', 'production_guide'].includes(mode)) {
      return NextResponse.json({ error: 'mode must be cooking_guide or production_guide' }, { status: 400 });
    }

    const odoo = getOdoo();
    let odooId: number;

    if (mode === 'cooking_guide') {
      // Create product.template for cooking guide
      const vals: Record<string, unknown> = {
        name: name.trim(),
        type: 'consu',
        sale_ok: false,
        purchase_ok: false,
        x_recipe_guide: true,
        x_recipe_published: false,
      };
      if (category_id) vals.x_recipe_category_id = category_id;
      odooId = await odoo.create('product.template', vals);

    } else {
      // Production guide: create product.template + mrp.bom
      const productVals: Record<string, unknown> = {
        name: name.trim(),
        type: 'consu',
        sale_ok: false,
        purchase_ok: false,
      };
      const productTmplId = await odoo.create('product.template', productVals);

      // Find the product.product variant created automatically
      const variants = await odoo.searchRead(
        'product.product',
        [['product_tmpl_id', '=', productTmplId]],
        ['id'],
        { limit: 1 },
      );
      const productId = variants.length > 0 ? variants[0].id : null;

      // Create the BoM
      const bomVals: Record<string, unknown> = {
        product_tmpl_id: productTmplId,
        product_qty: base_servings || 10,
        type: 'normal',
        x_recipe_guide: true,
        x_recipe_published: false,
      };
      if (category_id) bomVals.x_recipe_category_id = category_id;
      if (productId) bomVals.product_id = productId;

      odooId = await odoo.create('mrp.bom', bomVals);
    }

    return NextResponse.json({
      success: true,
      odoo_id: odooId,
      mode,
      message: `${name.trim()} created (ID: ${odooId})`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe create error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

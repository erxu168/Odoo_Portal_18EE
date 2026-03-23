/**
 * PUT /api/recipes/metadata
 *
 * Updates recipe metadata (name, category, difficulty, product_qty).
 * Any authenticated user can edit metadata.
 * Body: { product_tmpl_id?, bom_id?, name?, x_recipe_category_id?, x_recipe_difficulty?, product_qty? }
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { product_tmpl_id, bom_id, name, x_recipe_category_id, x_recipe_difficulty, product_qty } = body;

    if (!product_tmpl_id && !bom_id) {
      return NextResponse.json({ error: 'product_tmpl_id or bom_id required' }, { status: 400 });
    }

    if (x_recipe_difficulty && !['easy', 'medium', 'hard'].includes(x_recipe_difficulty)) {
      return NextResponse.json({ error: 'x_recipe_difficulty must be easy, medium, or hard' }, { status: 400 });
    }

    const odoo = getOdoo();
    const vals: Record<string, unknown> = {};

    if (name !== undefined) vals.name = name.trim();
    if (x_recipe_category_id !== undefined) vals.x_recipe_category_id = x_recipe_category_id || false;
    if (x_recipe_difficulty !== undefined) vals.x_recipe_difficulty = x_recipe_difficulty || false;

    if (product_tmpl_id) {
      if (Object.keys(vals).length > 0) {
        await odoo.write('product.template', [product_tmpl_id], vals);
      }
    }

    if (bom_id) {
      if (product_qty !== undefined) vals.product_qty = product_qty;
      if (Object.keys(vals).length > 0) {
        await odoo.write('mrp.bom', [bom_id], vals);
      }
    }

    return NextResponse.json({ success: true, message: 'Metadata updated' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe metadata PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

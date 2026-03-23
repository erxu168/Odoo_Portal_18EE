/**
 * POST /api/recipes/delete
 *
 * Soft-deletes a recipe (sets x_recipe_guide=false, x_recipe_published=false).
 * Admin only.
 * Body: { product_tmpl_id?, bom_id? }
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!hasRole(user, 'admin')) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { product_tmpl_id, bom_id } = body;

    if (!product_tmpl_id && !bom_id) {
      return NextResponse.json({ error: 'product_tmpl_id or bom_id required' }, { status: 400 });
    }

    const odoo = getOdoo();

    if (product_tmpl_id) {
      await odoo.write('product.template', [product_tmpl_id], {
        x_recipe_guide: false,
        x_recipe_published: false,
      });
    }
    if (bom_id) {
      await odoo.write('mrp.bom', [bom_id], {
        x_recipe_guide: false,
        x_recipe_published: false,
      });
    }

    return NextResponse.json({ success: true, message: 'Recipe deleted' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe delete error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

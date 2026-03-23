/**
 * POST /api/recipes/publish
 *
 * Publishes or unpublishes a recipe. Manager+ only.
 * Body: { product_tmpl_id?, bom_id?, action: 'publish' | 'unpublish' }
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager role required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { product_tmpl_id, bom_id, action } = body;

    if (!product_tmpl_id && !bom_id) {
      return NextResponse.json({ error: 'product_tmpl_id or bom_id required' }, { status: 400 });
    }
    if (!action || !['publish', 'unpublish'].includes(action)) {
      return NextResponse.json({ error: 'action must be publish or unpublish' }, { status: 400 });
    }

    const odoo = getOdoo();
    const published = action === 'publish';

    if (product_tmpl_id) {
      await odoo.write('product.template', [product_tmpl_id], { x_recipe_published: published });
    }
    if (bom_id) {
      await odoo.write('mrp.bom', [bom_id], { x_recipe_published: published });
    }

    return NextResponse.json({
      success: true,
      message: `Recipe ${published ? 'published' : 'unpublished'}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe publish error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

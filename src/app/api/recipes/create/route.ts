/**
 * POST /api/recipes/create
 *
 * Creates a new dish locally in SQLite.
 * For admin/manager: also creates product.template in Odoo and returns odoo_id.
 * For staff: local only, queued for sync.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initRecipeTables, createLocalRecipe } from '@/lib/recipe-db';
import { getOdoo } from '@/lib/odoo';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { name, mode, category_id, category_name, base_servings, unit, ingredients } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!mode || !['cooking_guide', 'production_guide'].includes(mode)) {
      return NextResponse.json({ error: 'mode must be cooking_guide or production_guide' }, { status: 400 });
    }

    initRecipeTables();

    const localId = createLocalRecipe({
      name: name.trim(),
      mode,
      category_name: category_name || '',
      base_servings: base_servings || 1,
      unit: unit || (mode === 'cooking_guide' ? 'servings' : 'kg'),
      ingredients_json: JSON.stringify(ingredients || []),
      created_by: user.id,
    });

    let odooId: number | null = null;

    // Admin/Manager: also create in Odoo so steps can be saved immediately
    if (hasRole(user, 'manager')) {
      try {
        const odoo = getOdoo();

        if (mode === 'cooking_guide') {
          // Create product.template for cooking guide recipes
          const vals: Record<string, unknown> = {
            name: name.trim(),
            type: 'consu',
            sale_ok: false,
            purchase_ok: false,
            x_recipe_published: false,
          };
          if (category_id) vals.x_recipe_category_id = category_id;
          odooId = await odoo.create('product.template', vals);
        }
        // Production guide: skip Odoo creation — admin should create BoM in Odoo directly
      } catch (odooErr: unknown) {
        const msg = odooErr instanceof Error ? odooErr.message : 'Unknown Odoo error';
        console.error('Odoo create failed (local saved):', msg);
        // Don't fail the request — local creation succeeded
      }
    }

    return NextResponse.json({
      success: true,
      local_id: localId,
      odoo_id: odooId,
      message: odooId
        ? `${name} created in Odoo (ID: ${odooId})`
        : `${name} created locally. Will sync to Odoo when connected.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe create error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

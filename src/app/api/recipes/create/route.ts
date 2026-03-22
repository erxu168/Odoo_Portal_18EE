/**
 * POST /api/recipes/create
 *
 * Creates a new dish locally in SQLite.
 * Queued for sync to Odoo (product.template or mrp.bom).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initRecipeTables, createLocalRecipe } from '@/lib/recipe-db';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { name, mode, category_name, base_servings, unit, ingredients } = body;

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

    return NextResponse.json({
      success: true,
      local_id: localId,
      message: `${name} created locally. Will sync to Odoo when connected.`,
    });
  } catch (err: any) {
    console.error('Recipe create error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/recipes
 *
 * Fetches published recipes from Odoo 18 EE.
 * Returns both cooking guide (product.template) and production guide (mrp.bom).
 * Query params: ?mode=cooking_guide|production_guide&search=bulgogi
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { initRecipeTables, getLocalRecipes, getCategoryIdsForCompany } from '@/lib/recipe-db';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');
  const search = searchParams.get('search');
  const companyId = parseInt(searchParams.get('company_id') || '0', 10);

  try {
    const odoo = getOdoo();
    const result: any = { cooking_guide: [], production_guide: [], categories: [], local_recipes: [] };

    // Cooking recipes carry no company, so scope them by their category → restaurant map.
    let cookingCatIds: number[] | null = null;
    if (companyId) { initRecipeTables(); cookingCatIds = getCategoryIdsForCompany(companyId); }

    // Fetch categories
    result.categories = await odoo.searchRead(
      'krawings.recipe.category', [],
      ['id', 'name', 'sequence', 'icon', 'mode', 'warehouse_ids', 'recipe_count'],
      { order: 'sequence' },
    );
    if (companyId) {
      result.categories = result.categories.filter((c: any) =>
        c.mode === 'production_guide' || (cookingCatIds || []).includes(c.id)
      );
    }

    // Cooking Guide recipes (product.template)
    if (!mode || mode === 'cooking_guide') {
      const domain: any[] = [
        ['x_recipe_guide', '=', true],
        ['x_recipe_published', '=', true],
      ];
      if (search) domain.push(['name', 'ilike', search]);
      if (companyId) domain.push(['x_recipe_category_id', 'in', (cookingCatIds && cookingCatIds.length) ? cookingCatIds : [-1]]);

      result.cooking_guide = await odoo.searchRead(
        'product.template', domain,
        [
          'id', 'name', 'x_recipe_guide', 'x_recipe_published',
          'x_recipe_category_id', 'x_recipe_difficulty',
          'x_recipe_step_count', 'categ_id', 'image_128',
        ],
        { order: 'name', limit: 200 },
      );
    }

    // Production Guide recipes (mrp.bom)
    if (!mode || mode === 'production_guide') {
      const domain: any[] = [
        ['x_recipe_guide', '=', true],
        ['x_recipe_published', '=', true],
      ];
      if (search) domain.push(['product_tmpl_id.name', 'ilike', search]);
      if (companyId) domain.push(['company_id', '=', companyId]);

      result.production_guide = await odoo.searchRead(
        'mrp.bom', domain,
        [
          'id', 'product_tmpl_id', 'product_qty', 'code',
          'x_recipe_guide', 'x_recipe_published',
          'x_recipe_category_id', 'x_recipe_difficulty',
          'x_cook_time_min', 'x_recipe_step_count', 'bom_line_ids',
        ],
        { order: 'product_tmpl_id', limit: 200 },
      );
    }

    // Include locally-created recipes not yet synced
    try {
      initRecipeTables();
      const localMode = mode as any;
      result.local_recipes = getLocalRecipes(localMode || undefined);
    } catch {
      // SQLite may not be ready
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Recipe list error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

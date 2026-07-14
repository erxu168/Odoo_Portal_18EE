/**
 * GET /api/recipes/categories
 *
 * Fetches recipe categories from Odoo.
 * Also fetches UoMs for the create dish form.
 * Query params: ?include_uom=true
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const includeUom = searchParams.get('include_uom') === 'true';

  try {
    const odoo = getOdoo();

    const categories = await odoo.searchRead(
      'krawings.recipe.category',
      [['active', '=', true]],
      ['id', 'name', 'sequence', 'icon', 'mode', 'warehouse_ids'],
      { order: 'sequence' },
    );

    const result: any = { categories };

    if (includeUom) {
      const uoms = await odoo.searchRead(
        'uom.uom',
        [['category_id.name', 'in', ['Weight', 'Volume', 'Unit']]],
        ['id', 'name', 'category_id', 'factor', 'rounding'],
        { order: 'category_id, factor', limit: 50 },
      );
      result.uoms = uoms;
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Recipe categories error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

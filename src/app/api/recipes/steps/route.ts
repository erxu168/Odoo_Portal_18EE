/**
 * GET /api/recipes/steps?product_tmpl_id=123  or  ?bom_id=456
 * POST /api/recipes/steps — create steps from recording
 *
 * Steps live in Odoo (krawings.recipe.step) — single source of truth.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const productTmplId = searchParams.get('product_tmpl_id');
  const bomId = searchParams.get('bom_id');

  if (!productTmplId && !bomId) {
    return NextResponse.json({ error: 'product_tmpl_id or bom_id required' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    const domain: any[] = [];
    if (productTmplId) domain.push(['product_tmpl_id', '=', parseInt(productTmplId)]);
    if (bomId) domain.push(['bom_id', '=', parseInt(bomId)]);

    const steps = await odoo.searchRead(
      'krawings.recipe.step', domain,
      [
        'id', 'sequence', 'step_type', 'instruction', 'timer_seconds',
        'tip', 'ingredient_ids', 'image_count', 'version_id',
      ],
      { order: 'sequence', limit: 100 },
    );

    // Resolve ingredient names
    const allIngIds = new Set<number>();
    for (const s of steps) {
      for (const id of (s.ingredient_ids || [])) allIngIds.add(id);
    }

    const ingredientMap: Record<number, { name: string; uom: string }> = {};
    if (allIngIds.size > 0) {
      const ingredients = await odoo.read(
        'product.product',
        [...allIngIds],
        ['id', 'name', 'uom_id'],
      );
      for (const ing of ingredients) {
        ingredientMap[ing.id] = {
          name: ing.name,
          uom: ing.uom_id?.[1] || '',
        };
      }
    }

    const enrichedSteps = steps.map((s: any) => ({
      ...s,
      ingredients: (s.ingredient_ids || []).map((id: number) => ({
        id,
        name: ingredientMap[id]?.name || `Product #${id}`,
        uom: ingredientMap[id]?.uom || '',
      })),
    }));

    return NextResponse.json({ steps: enrichedSteps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe steps GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { product_tmpl_id, bom_id, steps, change_summary } = body;

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'steps array required' }, { status: 400 });
    }
    if (!product_tmpl_id && !bom_id) {
      return NextResponse.json({ error: 'product_tmpl_id or bom_id required' }, { status: 400 });
    }

    const odoo = getOdoo();

    // 1. Create version record
    const versionVals: any = {
      status: 'review',
      change_summary: change_summary || 'New recipe recording',
    };
    if (product_tmpl_id) versionVals.product_tmpl_id = product_tmpl_id;
    if (bom_id) versionVals.bom_id = bom_id;

    const versionId = await odoo.create('krawings.recipe.version', versionVals);

    // 2. Create step records
    const createdIds: number[] = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const stepVals: any = {
        sequence: (i + 1) * 10,
        step_type: s.step_type || 'prep',
        instruction: s.instruction || '',
        timer_seconds: s.timer_seconds || 0,
        tip: s.tip || '',
        version_id: versionId,
      };
      if (product_tmpl_id) stepVals.product_tmpl_id = product_tmpl_id;
      if (bom_id) stepVals.bom_id = bom_id;

      if (s.ingredient_ids?.length) {
        stepVals.ingredient_ids = [[6, 0, s.ingredient_ids]];
      }

      const stepId = await odoo.create('krawings.recipe.step', stepVals);
      createdIds.push(stepId);

      // 3. Upload images if provided (base64)
      if (s.images?.length) {
        for (let j = 0; j < s.images.length; j++) {
          await odoo.create('krawings.recipe.step.image', {
            step_id: stepId,
            image: s.images[j].data,
            caption: s.images[j].caption || '',
            source: s.images[j].source || 'record',
            sort: (j + 1) * 10,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      version_id: versionId,
      step_ids: createdIds,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe steps POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

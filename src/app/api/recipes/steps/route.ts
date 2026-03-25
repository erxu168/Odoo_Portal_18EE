/**
 * GET /api/recipes/steps?product_tmpl_id=123  or  ?bom_id=456
 * POST /api/recipes/steps — create steps from recording
 *
 * Steps live in Odoo (krawings.recipe.step) — single source of truth.
 * Images are NOT loaded here — use /api/recipes/steps/images?step_id=X for lazy loading.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_STEP = 5;

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
        'tip', 'ingredient_ids', 'step_ingredient_ids', 'image_count', 'version_id',
      ],
      { order: 'sequence', limit: 100 },
    );

    // Read step_ingredient pivot records (new model with qty)
    const allPivotIds: number[] = [];
    for (const s of steps) {
      for (const id of (s.step_ingredient_ids || [])) {
        if (allPivotIds.indexOf(id) === -1) allPivotIds.push(id);
      }
    }

    interface PivotRecord { product_id: [number, string]; qty: number; uom_id: [number, string] | false; }
    const pivotMap = new Map<number, PivotRecord>();
    if (allPivotIds.length > 0) {
      try {
        const pivots = await odoo.read(
          'krawings.recipe.step.ingredient', allPivotIds,
          ['id', 'product_id', 'qty', 'uom_id', 'sequence'],
        );
        for (const p of pivots) {
          pivotMap.set(p.id, p);
        }
      } catch (_e) {
        // Model may not exist yet if upgrade hasn't run — fall back to old M2M
      }
    }

    // Fallback: resolve old M2M ingredient_ids for steps without pivot data
    const allOldIngIds: number[] = [];
    for (const s of steps) {
      if ((s.step_ingredient_ids || []).length === 0) {
        for (const id of (s.ingredient_ids || [])) {
          if (allOldIngIds.indexOf(id) === -1) allOldIngIds.push(id);
        }
      }
    }
    const oldIngMap: Record<number, { name: string; uom: string }> = {};
    if (allOldIngIds.length > 0) {
      const oldIngs = await odoo.read('product.product', allOldIngIds, ['id', 'name', 'uom_id']);
      for (const ing of oldIngs) {
        oldIngMap[ing.id] = { name: ing.name, uom: ing.uom_id?.[1] || '' };
      }
    }

    // Enrich steps with ingredient data
    const enrichedSteps = steps.map((s: any) => {
      // Prefer new pivot model
      if ((s.step_ingredient_ids || []).length > 0) {
        return {
          ...s,
          ingredients: s.step_ingredient_ids.map((pivotId: number) => {
            const p = pivotMap.get(pivotId);
            if (!p) return null;
            return {
              id: Array.isArray(p.product_id) ? p.product_id[0] : 0,
              name: Array.isArray(p.product_id) ? p.product_id[1] : 'Unknown',
              qty: p.qty || 0,
              uom: Array.isArray(p.uom_id) ? p.uom_id[1] : '',
              uom_id: Array.isArray(p.uom_id) ? p.uom_id[0] : null,
            };
          }).filter(Boolean),
        };
      }
      // Fallback to old M2M (no quantities)
      return {
        ...s,
        ingredients: (s.ingredient_ids || []).map((id: number) => ({
          id,
          name: oldIngMap[id]?.name || `Product #${id}`,
          qty: 0,
          uom: oldIngMap[id]?.uom || '',
          uom_id: null,
        })),
      };
    });

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
    const { product_tmpl_id, bom_id, steps, change_summary, auto_publish } = body;

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'steps array required' }, { status: 400 });
    }
    if (!product_tmpl_id && !bom_id) {
      return NextResponse.json({ error: 'product_tmpl_id or bom_id required' }, { status: 400 });
    }
    if (steps.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 steps per recipe' }, { status: 400 });
    }

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.images?.length) {
        if (s.images.length > MAX_IMAGES_PER_STEP) {
          return NextResponse.json({ error: `Step ${i + 1}: maximum ${MAX_IMAGES_PER_STEP} images per step` }, { status: 400 });
        }
        for (const img of s.images) {
          const approxBytes = (img.data?.length || 0) * 0.75;
          if (approxBytes > MAX_IMAGE_BYTES) {
            return NextResponse.json({ error: `Step ${i + 1}: image too large (max 5MB).` }, { status: 400 });
          }
        }
      }
      if (!s.instruction?.trim()) {
        return NextResponse.json({ error: `Step ${i + 1}: instruction cannot be empty` }, { status: 400 });
      }
    }

    const odoo = getOdoo();

    const versionDomain: any[] = [];
    if (product_tmpl_id) versionDomain.push(['product_tmpl_id', '=', product_tmpl_id]);
    if (bom_id) versionDomain.push(['bom_id', '=', bom_id]);
    const existingVersions = await odoo.searchRead(
      'krawings.recipe.version', versionDomain,
      ['version'], { order: 'version desc', limit: 1 },
    );
    const nextVersion = (existingVersions.length > 0 ? (existingVersions[0].version || 0) : 0) + 1;

    const versionVals: Record<string, unknown> = {
      version: nextVersion,
      status: auto_publish ? 'approved' : 'review',
      change_summary: change_summary || 'New recipe recording',
    };
    if (auto_publish) {
      versionVals.approved_at = new Date().toISOString().substring(0, 19).replace('T', ' ');
    }
    if (product_tmpl_id) versionVals.product_tmpl_id = product_tmpl_id;
    if (bom_id) versionVals.bom_id = bom_id;

    const versionId = await odoo.create('krawings.recipe.version', versionVals);
    const createdIds: number[] = [];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const stepVals: Record<string, unknown> = {
        sequence: (i + 1) * 10, step_type: s.step_type || 'prep',
        instruction: s.instruction || '', timer_seconds: s.timer_seconds || 0,
        tip: s.tip || '', version_id: versionId,
      };
      if (product_tmpl_id) stepVals.product_tmpl_id = product_tmpl_id;
      if (bom_id) stepVals.bom_id = bom_id;

      // Legacy M2M: also set ingredient_ids for backward compat
      const productIds: number[] = (s.ingredients || []).map((ing: any) => ing.product_id).filter(Boolean);
      if (s.ingredient_ids?.length) {
        stepVals.ingredient_ids = [[6, 0, s.ingredient_ids]];
      } else if (productIds.length > 0) {
        stepVals.ingredient_ids = [[6, 0, productIds]];
      }

      const stepId = await odoo.create('krawings.recipe.step', stepVals);
      createdIds.push(stepId);

      // Create pivot records (new model with qty/uom)
      if (s.ingredients?.length) {
        for (let k = 0; k < s.ingredients.length; k++) {
          const ing = s.ingredients[k];
          if (!ing.product_id) continue;
          try {
            await odoo.create('krawings.recipe.step.ingredient', {
              step_id: stepId,
              product_id: ing.product_id,
              qty: ing.qty || 0,
              uom_id: ing.uom_id || false,
              sequence: (k + 1) * 10,
            });
          } catch (_e) {
            // New model may not exist yet — silently skip
            console.warn('Could not create step ingredient pivot record:', _e);
          }
        }
      }

      if (s.images?.length) {
        for (let j = 0; j < s.images.length; j++) {
          await odoo.create('krawings.recipe.step.image', {
            step_id: stepId, image: s.images[j].data,
            caption: s.images[j].caption || '', source: s.images[j].source || 'record',
            sort: (j + 1) * 10,
          });
        }
      }
    }

    // Auto-publish: set x_recipe_published on the product/bom
    if (auto_publish) {
      if (product_tmpl_id) {
        await odoo.write('product.template', [product_tmpl_id], { x_recipe_published: true });
      }
      if (bom_id) {
        await odoo.write('mrp.bom', [bom_id], { x_recipe_published: true });
      }
    }

    return NextResponse.json({ success: true, version_id: versionId, version: nextVersion, step_ids: createdIds });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe steps POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

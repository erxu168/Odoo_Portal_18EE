/**
 * POST /api/recipes/sync
 *
 * Processes the offline sync queue.
 * Creates product.template / mrp.bom in Odoo for locally-created recipes.
 * GET returns queue status.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import {
  initRecipeTables,
  getPendingSyncItems,
  updateSyncItem,
  getUnsyncedRecipes,
  markRecipeSynced,
  getSyncQueueCount,
} from '@/lib/recipe-db';
import type { LocalRecipe, LocalIngredient } from '@/types/recipe';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    initRecipeTables();
    const pendingCount = getSyncQueueCount();
    const unsyncedRecipes = getUnsyncedRecipes();
    return NextResponse.json({
      pending_count: pendingCount,
      unsynced_recipes: unsyncedRecipes.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    initRecipeTables();
    const odoo = getOdoo();
    const items = getPendingSyncItems();
    const results: { id: number; action: string; success: boolean; error?: string }[] = [];

    for (const item of items) {
      updateSyncItem(item.id, 'processing');

      try {
        const payload = JSON.parse(item.payload_json);

        if (item.action === 'create_recipe') {
          await syncCreateRecipe(odoo, payload.local_id);
        }

        updateSyncItem(item.id, 'done');
        results.push({ id: item.id, action: item.action, success: true });
      } catch (innerErr: unknown) {
        const innerMsg = innerErr instanceof Error ? innerErr.message : 'Unknown error';
        updateSyncItem(item.id, 'failed', innerMsg);
        results.push({ id: item.id, action: item.action, success: false, error: innerMsg });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Recipe sync error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function syncCreateRecipe(odoo: any, localId: number): Promise<void> {
  const unsynced = getUnsyncedRecipes();
  const recipe = unsynced.find((r: LocalRecipe) => r.id === localId);
  if (!recipe) throw new Error(`Local recipe ${localId} not found`);
  if (recipe.odoo_synced) return;

  const ingredients: LocalIngredient[] = JSON.parse(recipe.ingredients_json || '[]');

  if (recipe.mode === 'cooking_guide') {
    const odooId = await odoo.create('product.template', {
      name: recipe.name,
      type: 'consu',
      available_in_pos: true,
      x_recipe_guide: true,
      x_recipe_published: false,
    });
    markRecipeSynced(recipe.id, odooId);

  } else if (recipe.mode === 'production_guide') {
    // Lot tracking is on by default so MO labels can be printed.
    const productId = await odoo.create('product.template', {
      name: recipe.name,
      type: 'consu',
      tracking: 'lot',
    });

    const variants = await odoo.searchRead(
      'product.product',
      [['product_tmpl_id', '=', productId]],
      ['id'],
      { limit: 1 },
    );
    const variantId = variants[0]?.id;
    if (!variantId) throw new Error('Could not find product variant');

    const bomId = await odoo.create('mrp.bom', {
      product_tmpl_id: productId,
      product_qty: recipe.base_servings,
      type: 'normal',
      x_recipe_guide: true,
      x_recipe_published: false,
    });

    for (const ing of ingredients) {
      if (!ing.name) continue;
      const productIds = await odoo.searchRead(
        'product.product',
        [['name', 'ilike', ing.name]],
        ['id'],
        { limit: 1 },
      );
      let ingProductId: number;
      if (productIds.length > 0) {
        ingProductId = productIds[0].id;
      } else {
        const newTmplId = await odoo.create('product.template', {
          name: ing.name,
          type: 'consu',
        });
        const newVariants = await odoo.searchRead(
          'product.product',
          [['product_tmpl_id', '=', newTmplId]],
          ['id'],
          { limit: 1 },
        );
        ingProductId = newVariants[0]?.id;
      }

      if (ingProductId) {
        await odoo.create('mrp.bom.line', {
          bom_id: bomId,
          product_id: ingProductId,
          product_qty: ing.qty || 0,
        });
      }
    }

    markRecipeSynced(recipe.id, bomId);
  }
}

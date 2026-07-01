/**
 * Featured dishes for the Cooking Board (per restaurant).
 *
 * GET    ?company_id=&mode=cooking|production
 *        → { featured: FeaturedRecipe[], source: 'manual' | 'auto' }
 *          Returns the manager-curated list; if empty, falls back to the most-cooked dishes.
 * POST   { company_id, mode, recipe_id, recipe_name, base_qty? }  (manager+)  → mark featured
 * DELETE { company_id, mode, recipe_id }                          (manager+)  → un-feature
 */
import { NextResponse } from 'next/server';
import { requireAuth, requireRole, AuthError } from '@/lib/auth';
import {
  initRecipeTables, listFeatured, addFeatured, removeFeatured,
} from '@/lib/recipe-db';

function normMode(raw: unknown): 'cooking' | 'production' {
  return raw === 'production' ? 'production' : 'cooking';
}

export async function GET(request: Request) {
  try {
    requireAuth();
    initRecipeTables();
    const { searchParams } = new URL(request.url);
    const companyId = parseInt(searchParams.get('company_id') || '0', 10);
    const modeParam = searchParams.get('mode');
    if (!companyId) return NextResponse.json({ featured: [], source: 'manual' });

    // mode=all → one combined prep list (cooking + production) for the restaurant.
    // Manager-curated ONLY — no auto-suggest, so staff see exactly what the manager chose.
    if (modeParam === 'all') {
      const manualAll = [...listFeatured(companyId, 'cooking'), ...listFeatured(companyId, 'production')];
      return NextResponse.json({ featured: manualAll, source: 'manual' });
    }

    // Single-mode: manager-curated only (no most-cooked guessing).
    const mode = normMode(modeParam);
    return NextResponse.json({ featured: listFeatured(companyId, mode), source: 'manual' });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to load featured dishes' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = requireRole('manager');
    initRecipeTables();
    const body = await request.json();
    const companyId = parseInt(String(body.company_id), 10);
    const recipeId = parseInt(String(body.recipe_id), 10);
    if (!companyId || !recipeId || !body.recipe_name) {
      return NextResponse.json({ error: 'company_id, recipe_id and recipe_name are required' }, { status: 400 });
    }
    addFeatured({
      company_id: companyId,
      mode: normMode(body.mode),
      recipe_id: recipeId,
      recipe_name: String(body.recipe_name),
      base_qty: Number(body.base_qty) > 0 ? Number(body.base_qty) : 1,
      featured_by: user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to feature dish' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    requireRole('manager');
    initRecipeTables();
    const body = await request.json();
    const companyId = parseInt(String(body.company_id), 10);
    const recipeId = parseInt(String(body.recipe_id), 10);
    if (!companyId || !recipeId) {
      return NextResponse.json({ error: 'company_id and recipe_id are required' }, { status: 400 });
    }
    removeFeatured(companyId, normMode(body.mode), recipeId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to remove dish' }, { status: 500 });
  }
}

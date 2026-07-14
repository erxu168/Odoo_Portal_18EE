/**
 * POST /api/recipes/cooked
 *
 * Records that a dish was started, feeding the "most cooked" auto-fallback on the
 * Cooking Board. Any authenticated cook may log. Fire-and-forget from the client.
 * Body: { company_id, mode, recipe_id, recipe_name, base_qty? }
 */
import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { initRecipeTables, logCook } from '@/lib/recipe-db';

export async function POST(request: Request) {
  try {
    requireAuth();
    initRecipeTables();
    const body = await request.json();
    const companyId = parseInt(String(body.company_id), 10);
    const recipeId = parseInt(String(body.recipe_id), 10);
    if (!companyId || !recipeId || !body.recipe_name) {
      return NextResponse.json({ error: 'company_id, recipe_id and recipe_name are required' }, { status: 400 });
    }
    logCook({
      company_id: companyId,
      mode: body.mode === 'production' ? 'production' : 'cooking',
      recipe_id: recipeId,
      recipe_name: String(body.recipe_name),
      base_qty: Number(body.base_qty) > 0 ? Number(body.base_qty) : 1,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to log cook' }, { status: 500 });
  }
}

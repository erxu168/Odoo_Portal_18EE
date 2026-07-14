/**
 * Recipe ingredient editing (manager/admin only).
 *
 * PATCH  { updates: [{ pivot_id, qty }, ...] }              — change amounts
 * POST   { step_id, product_id, qty, uom_id }               — add an ingredient
 * DELETE { pivot_id }                                       — remove an ingredient
 */
import { NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function PATCH(request: Request) {
  try {
    requireCapability('recipes.ingredients.manage');
    const body = await request.json();
    const updates = Array.isArray(body.updates) ? body.updates : null;
    if (!updates) return NextResponse.json({ error: 'updates array required' }, { status: 400 });

    const odoo = getOdoo();
    let applied = 0;
    for (const u of updates) {
      const pivotId = parseInt(String(u.pivot_id), 10);
      const qty = Number(u.qty);
      if (!pivotId || !Number.isFinite(qty) || qty < 0) continue;
      await odoo.write('krawings.recipe.step.ingredient', [pivotId], { qty });
      applied++;
    }
    return NextResponse.json({ ok: true, applied });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to update ingredient amounts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    requireCapability('recipes.ingredients.manage');
    const body = await request.json();
    const stepId = parseInt(String(body.step_id), 10);
    const productId = parseInt(String(body.product_id), 10);
    const qty = Number(body.qty) > 0 ? Number(body.qty) : 0;
    const uomId = body.uom_id ? parseInt(String(body.uom_id), 10) : false;
    if (!stepId || !productId) return NextResponse.json({ error: 'step_id and product_id required' }, { status: 400 });

    const odoo = getOdoo();
    const pivotId = await odoo.create('krawings.recipe.step.ingredient', {
      step_id: stepId, product_id: productId, qty, uom_id: uomId, sequence: 999,
    });
    // Keep the legacy M2M in sync (harmless if unused).
    try { await odoo.write('krawings.recipe.step', [stepId], { ingredient_ids: [[4, productId]] }); } catch { /* fallback field may not matter */ }
    return NextResponse.json({ ok: true, pivot_id: pivotId });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to add ingredient' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    requireCapability('recipes.ingredients.manage');
    const body = await request.json();
    const pivotId = parseInt(String(body.pivot_id), 10);
    if (!pivotId) return NextResponse.json({ error: 'pivot_id required' }, { status: 400 });
    const odoo = getOdoo();
    await odoo.unlink('krawings.recipe.step.ingredient', [pivotId]);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to remove ingredient' }, { status: 500 });
  }
}

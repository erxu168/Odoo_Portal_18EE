/**
 * PATCH /api/recipes/ingredients
 *
 * Updates the quantity of recipe step-ingredients. Manager/admin only.
 * Body: { updates: [{ pivot_id: number, qty: number }, ...] }
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function PATCH(request: Request) {
  try {
    requireRole('manager');
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

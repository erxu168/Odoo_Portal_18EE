import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

const EDITABLE_STATES = ['draft', 'confirmed', 'progress'];

async function guardEditableMove(
  odoo: ReturnType<typeof getOdoo>,
  moId: number,
  moveId: number,
  opts: { requireUnconsumed?: boolean } = {},
) {
  const mos = await odoo.read('mrp.production', [moId], ['id', 'state']);
  if (!mos.length) return { error: 'MO not found', status: 404 };
  if (!EDITABLE_STATES.includes(mos[0].state)) {
    return { error: `MO state '${mos[0].state}' is not editable.`, status: 409 };
  }
  const moves = await odoo.read('stock.move', [moveId], [
    'id', 'raw_material_production_id', 'state', 'quantity', 'product_uom',
  ]);
  if (!moves.length) return { error: 'Component not found', status: 404 };
  const m = moves[0];
  if ((m.raw_material_production_id?.[0]) !== moId) {
    return { error: 'Component does not belong to this MO', status: 409 };
  }
  // PATCH: allow changing planned qty even on already-consumed moves.
  // DELETE: still refuse if anything has been consumed (no undo).
  if (opts.requireUnconsumed && (m.quantity ?? 0) > 0) {
    return { error: 'Component already partially consumed; cannot remove.', status: 409 };
  }
  return { move: m };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; moveId: string } },
) {
  try {
    requireAuth();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const moId = Number(params.id);
  const moveId = Number(params.moveId);
  if (!Number.isInteger(moId) || !Number.isInteger(moveId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: { qty?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'qty must be a positive number' }, { status: 400 });
  }

  const odoo = getOdoo();
  const guard = await guardEditableMove(odoo, moId, moveId);
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  await odoo.write('stock.move', [moveId], { product_uom_qty: qty });
  return NextResponse.json({ move_id: moveId, planned_qty: qty });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; moveId: string } },
) {
  try {
    requireAuth();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const moId = Number(params.id);
  const moveId = Number(params.moveId);
  if (!Number.isInteger(moId) || !Number.isInteger(moveId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const odoo = getOdoo();
  const guard = await guardEditableMove(odoo, moId, moveId, { requireUnconsumed: true });
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Cancel the move instead of unlink — Odoo's manufacturing flow keeps
  // the record but in 'cancel' state; the GET handler filters those out.
  await odoo.call('stock.move', '_action_cancel', [[moveId]]);
  return NextResponse.json({ move_id: moveId, cancelled: true });
}

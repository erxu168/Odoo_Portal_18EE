/**
 * GET /api/products/[id]/shelf-life
 * Returns chilled_days and frozen_days for the given product.template id.
 *
 * PATCH /api/products/[id]/shelf-life
 * Updates one or both values. Manager+ only.
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, hasRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tmplId = parseInt(params.id, 10);
  if (!Number.isFinite(tmplId) || tmplId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    const rows = await odoo.read('product.template', [tmplId], [
      'x_shelf_life_chilled_days',
      'x_shelf_life_frozen_days',
    ]);
    if (!rows.length) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({
      chilled_days: rows[0].x_shelf_life_chilled_days || 0,
      frozen_days: rows[0].x_shelf_life_frozen_days || 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to read shelf life';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager role required' }, { status: 403 });
  }

  const tmplId = parseInt(params.id, 10);
  if (!Number.isFinite(tmplId) || tmplId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  let body: { chilled_days?: unknown; frozen_days?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const update: Record<string, number> = {};
  for (const key of ['chilled_days', 'frozen_days'] as const) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 999) {
      return NextResponse.json(
        { error: `${key} must be an integer between 0 and 999` },
        { status: 400 },
      );
    }
    update[key === 'chilled_days' ? 'x_shelf_life_chilled_days' : 'x_shelf_life_frozen_days'] = v;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    await odoo.call('product.template', 'write', [[tmplId], update]);
    const rows = await odoo.read('product.template', [tmplId], [
      'x_shelf_life_chilled_days',
      'x_shelf_life_frozen_days',
    ]);
    return NextResponse.json({
      chilled_days: rows[0]?.x_shelf_life_chilled_days || 0,
      frozen_days: rows[0]?.x_shelf_life_frozen_days || 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update shelf life';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

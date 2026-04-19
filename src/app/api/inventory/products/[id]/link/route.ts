export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/products/[id]/link
 *
 * Links a draft product's barcode to an existing real product.
 * Count lines referencing the draft are reassigned to the target.
 * The draft stays active=False (effectively dead).
 *
 * Body: { target_product_id: number }
 * Manager+ only.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, reassignCountsForProduct } from '@/lib/inventory-db';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const draftId = parseInt(params.id, 10);
  if (isNaN(draftId) || draftId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    initInventoryTables();
    const body = await request.json();
    const targetId = Number(body.target_product_id);
    if (!targetId || targetId === draftId) {
      return NextResponse.json({ error: 'target_product_id required and must differ' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Load draft product (must exist, must be inactive, must have barcode)
    const drafts = await odoo.searchRead(
      'product.product',
      [['id', '=', draftId]],
      ['id', 'active', 'barcode'],
      { limit: 1, context: { active_test: false } },
    );
    if (drafts.length === 0) {
      return NextResponse.json({ error: 'Draft product not found' }, { status: 404 });
    }
    const draft = drafts[0];
    if (draft.active === true) {
      return NextResponse.json({ error: 'Product is not a draft' }, { status: 400 });
    }
    if (!draft.barcode) {
      return NextResponse.json({ error: 'Draft has no barcode' }, { status: 400 });
    }

    // Load target product (must exist, must NOT be POS)
    const targets = await odoo.searchRead(
      'product.product',
      [['id', '=', targetId]],
      ['id', 'name', 'barcode', 'active', 'available_in_pos'],
      { limit: 1 },
    );
    if (targets.length === 0) {
      return NextResponse.json({ error: 'Target product not found' }, { status: 404 });
    }
    const target = targets[0];
    if (target.available_in_pos === true) {
      return NextResponse.json(
        { error: 'Cannot link to a POS product — inventory counts only apply to non-POS stock' },
        { status: 400 },
      );
    }
    if (target.barcode && target.barcode !== draft.barcode) {
      return NextResponse.json(
        { error: `Target product already has barcode: ${target.barcode}` },
        { status: 409 },
      );
    }

    // Clear barcode from draft first so Odoo's unique constraint doesn't fire
    await odoo.write('product.product', [draftId], { barcode: false });
    await odoo.write('product.product', [targetId], { barcode: draft.barcode });

    // Reassign all count lines
    const rowsChanged = reassignCountsForProduct(draftId, targetId);

    return NextResponse.json({ success: true, rows_changed: rowsChanged });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/link POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

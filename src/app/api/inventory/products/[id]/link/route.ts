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
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, reassignCountsForProduct, markDraftStatus, isDraftProduct, LinkConflictError } from '@/lib/inventory-db';
import { moduleForbidden } from '@/lib/module-access';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const denied = moduleForbidden(['inventory', 'products']);
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.draft.review', getPermissionOverrides())) {
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
    // "Inactive" is NOT "is a draft" — every archived product is inactive too,
    // and this endpoint MOVES a barcode and rewrites count history. Without this
    // check an archived product's id posted here would strip its barcode and
    // reassign its counts to something else.
    if (!isDraftProduct(draftId)) {
      return NextResponse.json({
        error: 'That is not a scanned draft. Archived products are managed from the product page.',
      }, { status: 400 });
    }
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

    // ORDER MATTERS, and it used to be the wrong way round.
    //
    // The counts move FIRST, in one transaction. If that fails, nothing has
    // changed: the draft still holds its barcode and the manager can try again.
    // Previously the barcode was moved first, so a database failure left the
    // draft with no barcode at all — and the barcode is the only thing
    // identifying it, so there was nothing left to retry from.
    let rowsChanged: number;
    try {
      rowsChanged = reassignCountsForProduct(draftId, targetId);
    } catch (e: unknown) {
      // Both products counted in the same place in the same count. Refused
      // rather than merged: summing could double-count the same physical items
      // and keeping one silently discards a real observation, and either way a
      // manager cannot tell which happened.
      if (e instanceof LinkConflictError) {
        return NextResponse.json({
          error: `Both have already been counted in the same place (${e.where.join(', ')}). `
            + 'Clear one of those counts first, then join them.',
          code: 'LINK_CONFLICT',
          where: e.where,
        }, { status: 409 });
      }
      throw e;
    }

    // Then the barcode. Cleared from the draft first so Odoo's own uniqueness
    // check cannot fire on the second write.
    //
    // If THIS half fails the counts have already moved, which is the milder
    // failure: the target holds the numbers, the draft holds its barcode, the
    // draft is still pending, and repeating the operation finishes the job.
    await odoo.write('product.product', [draftId], { barcode: false });
    await odoo.write('product.product', [targetId], { barcode: draft.barcode });

    markDraftStatus(draftId, 'linked');

    return NextResponse.json({ success: true, rows_changed: rowsChanged });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/link POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/products/[id]/reject
 *
 * Rejects a draft product. Any count lines referencing it are removed.
 * The draft itself stays active=False in Odoo (no-op beyond what it is).
 *
 * Manager+ only.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, deleteCountsForProduct } from '@/lib/inventory-db';

export async function POST(
  _request: Request,
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
    const odoo = getOdoo();

    const drafts = await odoo.searchRead(
      'product.product',
      [['id', '=', draftId]],
      ['id', 'active'],
      { limit: 1, context: { active_test: false } },
    );
    if (drafts.length === 0) {
      return NextResponse.json({ error: 'Draft product not found' }, { status: 404 });
    }
    if (drafts[0].active === true) {
      return NextResponse.json({ error: 'Product is not a draft' }, { status: 400 });
    }

    const rowsDeleted = deleteCountsForProduct(draftId);
    return NextResponse.json({ success: true, rows_deleted: rowsDeleted });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/reject POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

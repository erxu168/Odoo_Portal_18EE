export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/products/[id]/reject
 *
 * Rejects a draft product. Any count lines referencing it are removed.
 * The draft itself stays active=False in Odoo (no-op beyond what it is).
 *
 * Manager+ only.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { companyScope } from '@/lib/inventory-access';
import { initInventoryTables, deleteCountsForProduct, markDraftStatus, describeCountWorkForProduct, isDraftProduct } from '@/lib/inventory-db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // NOTE: the draft check below (isDraftProduct) is what confines this to
  // scan-created drafts. Without it, "inactive" was the only test — so any
  // ARCHIVED product's id could be posted here to wipe its open count lines and
  // mark it rejected. Archived products are ordinary retired stock, not drafts.
  if (!roleCan(user.role, 'inventory.draft.review', getPermissionOverrides())) {
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
    // "Inactive" is NOT the same as "is a draft". Every archived product is
    // inactive too, and this endpoint erases open count lines — so without this
    // check an archived product's id posted here would wipe its counting history
    // and mark it rejected.
    if (!isDraftProduct(draftId)) {
      return NextResponse.json({
        error: 'That is not a scanned draft. Archived products are managed from the product page.',
      }, { status: 400 });
    }
    if (drafts[0].active === true) {
      return NextResponse.json({ error: 'Product is not a draft' }, { status: 400 });
    }

    const work = describeCountWorkForProduct(draftId);

    // COMPANY SCOPING. The work is described twice on purpose: once for
    // everywhere, and once narrowed to the restaurants this user may see. If the
    // two disagree, this draft has been counted somewhere they have no business
    // deleting from — a WAJ manager must not be able to erase a line out of
    // Ssam's count — so refuse rather than quietly wipe it.
    //
    // Inferred from WHERE THE COUNTING HAPPENED because the drafts table carries
    // no company of its own; it records a barcode and who scanned it, nothing
    // more. That also means a draft nobody has counted yet is visible to every
    // manager, which is a listing question rather than a data-loss one.
    const visible = companyScope(user);                 // undefined = every company
    if (visible !== undefined) {
      const mine = describeCountWorkForProduct(draftId, visible);
      if (mine.total !== work.total) {
        return NextResponse.json({
          error: 'This was counted at another restaurant, so it has to be dealt with there.',
          code: 'OTHER_COMPANY_WORK',
        }, { status: 403 });
      }
    }

    // Rejecting DOES erase counting work — deleteCountsForProduct hard-deletes
    // the entries and quick counts in every OPEN count. That is right (a rejected
    // draft must be able to leave), but it must never be silent, which is the
    // same fault the delete guard exists to prevent. So: unless the caller has
    // already been shown what will go and confirmed it, refuse and hand back the
    // list.
    const confirmed = request.nextUrl.searchParams.get('confirm') === '1';
    if (work.total > 0 && !confirmed) {
      return NextResponse.json({
        error: `Someone has already counted this — ${work.where.join(', ')}. Rejecting it deletes those numbers.`,
        code: 'WOULD_ERASE_COUNTS',
        work,
      }, { status: 409 });
    }

    const rowsDeleted = deleteCountsForProduct(draftId);
    markDraftStatus(draftId, 'rejected');
    // `erased` is what was ACTUALLY deleted, not work.total — which is what this
    // used to return and was frequently larger. deleteCountsForProduct only
    // touches counts still open; a line on a count already submitted or approved
    // stays, deliberately, because that is a record of what was on the shelf.
    // Reporting the bigger number told the caller history had been rewritten
    // when it had not.
    return NextResponse.json({
      success: true,
      rows_deleted: rowsDeleted,
      erased: rowsDeleted,
      kept: Math.max(0, work.total - rowsDeleted),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/reject POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

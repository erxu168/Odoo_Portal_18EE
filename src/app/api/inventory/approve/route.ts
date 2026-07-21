export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/approve
 *
 * Manager/Admin approves a counting session.
 * Updates status to approved first, then attempts to write to Odoo.
 * If Odoo write fails, session is still approved but with a warning.
 *
 * Body: { session_id: number, review_note?: string }
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { canAccessSession } from '@/lib/inventory-access';
import {
  initInventoryTables,
  getSession,
  getSessionEntries,
  updateSessionStatus,
} from '@/lib/inventory-db';
import { inventoryOdooSyncEnabled } from '@/lib/inventory-config';


export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.review.approve', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  initInventoryTables();
  const body = await request.json();
  const { session_id, review_note } = body;
  if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const session = getSession(session_id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!canAccessSession(user, session))
    return NextResponse.json({ error: 'This count belongs to another restaurant' }, { status: 403 });
  if (session.status !== 'submitted') {
    return NextResponse.json({ error: 'Session must be in submitted status' }, { status: 400 });
  }

  // Atomically claim the approval (only from 'submitted') BEFORE reading the
  // entries — a manager line-correction checks for 'submitted' too, so once the
  // claim lands no late correction can slip between our read and the write.
  if (updateSessionStatus(session_id, 'approved', { reviewed_by: user.id, review_note, fromStatus: 'submitted' }) === 0) {
    return NextResponse.json({ error: 'This count was just changed by someone else — reload.' }, { status: 409 });
  }
  const entries = getSessionEntries(session_id);
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No count entries to approve' }, { status: 400 });
  }

  // Aggregate per product BEFORE touching Odoo. The same product can be counted
  // at several spots, so its spot rows MUST be summed into a single write —
  // never a race of several writes to the same quant. odoo_qty is the Odoo-safe
  // quantity (out-of-stock = 0); a null row is portal-only (e.g. a simple count
  // with no average) and is excluded from the Odoo write entirely.
  const writeByProduct = new Map<number, number>();
  for (const e of entries) {
    const oq = e.odoo_qty === undefined ? e.counted_qty : e.odoo_qty;  // legacy safety
    if (oq === null) continue;                                          // portal-only
    writeByProduct.set(e.product_id, (writeByProduct.get(e.product_id) || 0) + Number(oq));
  }
  const writableProductIds = Array.from(writeByProduct.keys());
  const distinctProducts = new Set(entries.map(e => e.product_id)).size;
  const odooSync = inventoryOdooSyncEnabled();

  // Best-effort Odoo sync. The portal is the record of the count; Odoo stock
  // is only updated for products Odoo actually tracks (storable). Non-storable
  // products (or an Odoo outage) simply don't sync — the count is still approved.
  const syncedProducts: number[] = [];
  const failedEntries: { product_id: number; error: string }[] = [];
  let syncError: string | null = null;

  if (odooSync && writableProductIds.length > 0) {
    try {
      const odoo = getOdoo();

      // One stock.quant lookup for every product in this session.
      const existingQuants = await odoo.searchRead('stock.quant', [
        ['product_id', 'in', writableProductIds],
        ['location_id', '=', session.location_id],
      ], ['id', 'product_id'], { order: 'id asc', limit: 20000 });
      // If the result window is full we can't trust per-product counts (one heavily
      // lot-tracked product could crowd others out), so fail closed for safety.
      const quantsTruncated = existingQuants.length >= 20000;
      const quantByProduct = new Map<number, number>();
      const quantCountByProduct = new Map<number, number>();
      for (const q of existingQuants) {
        const pid = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
        quantCountByProduct.set(pid, (quantCountByProduct.get(pid) || 0) + 1);
        // First match wins so the choice is deterministic across calls.
        if (!quantByProduct.has(pid)) quantByProduct.set(pid, q.id);
      }

      // One write per PRODUCT (summed across spots), in parallel. Per-product
      // try/catch so a single failure doesn't block the others. Capture the
      // exact quant id each touched so we apply ONLY those.
      const appliedQuantIds: number[] = [];
      await Promise.all(writableProductIds.map(async (productId) => {
        const qty = writeByProduct.get(productId)!;
        try {
          // Several stock records for one product@location (lot/package/owner), or a
          // truncated lookup — don't guess which to overwrite; flag for manual Odoo
          // adjustment rather than risk a duplicate quant.
          if (quantsTruncated || (quantCountByProduct.get(productId) || 0) > 1) {
            failedEntries.push({
              product_id: productId,
              error: quantsTruncated
                ? 'Too many stock records at this location to sync safely — adjust in Odoo'
                : 'Several stock records exist (lot/package) — adjust in Odoo',
            });
            return;
          }
          const existingId = quantByProduct.get(productId);
          let quantId: number;
          if (existingId) {
            quantId = existingId;
            await odoo.write('stock.quant', [existingId], {
              inventory_quantity: qty,
              inventory_quantity_set: true,
            });
          } else {
            quantId = await odoo.create('stock.quant', {
              product_id: productId,
              location_id: session.location_id,
              inventory_quantity: qty,
              inventory_quantity_set: true,
            }) as number;
          }
          appliedQuantIds.push(quantId);
          syncedProducts.push(productId);
        } catch (entryErr: unknown) {
          const msg = entryErr instanceof Error ? entryErr.message : String(entryErr);
          console.error(`Odoo inventory write failed for product ${productId}:`, msg);
          failedEntries.push({ product_id: productId, error: msg });
        }
      }));

      // Apply ONLY the quants this approval wrote — never re-scan and sweep every
      // pending inventory_quantity_set quant at the location (which could commit
      // another session's or a manual, unrelated adjustment).
      if (appliedQuantIds.length > 0) {
        await odoo.call('stock.quant', 'action_apply_inventory', [appliedQuantIds]);
      }
    } catch (err: unknown) {
      // A whole-sync failure (e.g. Odoo unreachable) is non-fatal — the count is
      // still recorded/approved in the portal. Odoo stock is a best-effort push.
      syncError = err instanceof Error ? err.message : String(err);
      console.error('Odoo inventory sync failed entirely:', syncError);
    }
  }

  // Already atomically approved above (before the Odoo sync). The count is recorded
  // in the portal regardless of the Odoo outcome; stock updates only for products
  // Odoo can track (storable). Portal-only products (no average) are recorded here only.
  const needsManual = failedEntries.length;
  const notSynced = distinctProducts - syncedProducts.length - needsManual;
  let warning: string | null = null;
  if (!odooSync) {
    warning = null;                       // portal is the record; nothing to sync to Odoo
  } else if (syncError) {
    warning = `Approved and recorded. Couldn’t reach Odoo to update stock (${syncError}).`;
  } else if (needsManual > 0) {
    warning = `Approved. ${syncedProducts.length} updated in Odoo; ${needsManual} product${needsManual !== 1 ? 's' : ''} need manual adjustment in Odoo (several stock records exist).`;
  } else if (notSynced > 0) {
    warning = syncedProducts.length === 0
      ? 'Approved and recorded. Odoo stock was not updated — these products aren’t stock-tracked in Odoo.'
      : `Approved. ${syncedProducts.length} updated in Odoo; ${notSynced} recorded here only.`;
  }

  return NextResponse.json({
    message: warning || `Approved ${distinctProducts} product${distinctProducts !== 1 ? 's' : ''}`,
    warning,
    synced_count: syncedProducts.length,
    failed_entries: failedEntries.length > 0 ? failedEntries : undefined,
    entries_count: entries.length,
  });
}

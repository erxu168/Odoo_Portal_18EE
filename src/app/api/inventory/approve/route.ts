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

  const entries = getSessionEntries(session_id);
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No count entries to approve' }, { status: 400 });
  }

  // Best-effort Odoo sync. The portal is the record of the count; Odoo stock
  // is only updated for products Odoo actually tracks (storable). Non-storable
  // products (or an Odoo outage) simply don't sync — the count is still approved.
  const syncedEntries: number[] = [];
  const failedEntries: { product_id: number; error: string }[] = [];
  let syncError: string | null = null;

  try {
    const odoo = getOdoo();

    // One stock.quant lookup for every product in this session, instead
    // of one round-trip per entry. Up to ~50 entries fits comfortably
    // under the default search_read limit.
    const productIds = entries.map(e => e.product_id);
    const existingQuants = await odoo.searchRead('stock.quant', [
      ['product_id', 'in', productIds],
      ['location_id', '=', session.location_id],
    ], ['id', 'product_id'], {
      order: 'id asc',
      limit: Math.max(200, productIds.length * 2),
    });
    const quantByProduct = new Map<number, number>();
    for (const q of existingQuants) {
      const pid = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
      // First match wins so the choice is deterministic across calls.
      if (!quantByProduct.has(pid)) quantByProduct.set(pid, q.id);
    }

    // Run every per-entry write/create in parallel. Per-entry try/catch
    // is preserved so a single failure doesn't block the others. Capture the
    // exact quant id each entry touched so we apply ONLY those.
    const appliedQuantIds: number[] = [];
    await Promise.all(entries.map(async (entry) => {
      try {
        const existingId = quantByProduct.get(entry.product_id);
        let quantId: number;
        if (existingId) {
          quantId = existingId;
          await odoo.write('stock.quant', [existingId], {
            inventory_quantity: entry.counted_qty,
            inventory_quantity_set: true,
          });
        } else {
          quantId = await odoo.create('stock.quant', {
            product_id: entry.product_id,
            location_id: session.location_id,
            inventory_quantity: entry.counted_qty,
            inventory_quantity_set: true,
          }) as number;
        }
        appliedQuantIds.push(quantId);
        syncedEntries.push(entry.product_id);
      } catch (entryErr: unknown) {
        const msg = entryErr instanceof Error ? entryErr.message : String(entryErr);
        console.error(`Odoo inventory write failed for product ${entry.product_id}:`, msg);
        failedEntries.push({ product_id: entry.product_id, error: msg });
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

  // Approve regardless of the Odoo outcome. The count is recorded in the portal;
  // Odoo stock updates only for products it can track (storable).
  updateSessionStatus(session_id, 'approved', {
    reviewed_by: user.id,
    review_note,
  });

  const notSynced = entries.length - syncedEntries.length;
  let warning: string | null = null;
  if (syncError) {
    warning = `Approved and recorded. Couldn’t reach Odoo to update stock (${syncError}).`;
  } else if (notSynced > 0) {
    warning = syncedEntries.length === 0
      ? 'Approved and recorded. Odoo stock was not updated — these products aren’t stock-tracked in Odoo.'
      : `Approved. ${syncedEntries.length} updated in Odoo; ${notSynced} recorded here only (not stock-tracked in Odoo).`;
  }

  return NextResponse.json({
    message: warning || `Approved ${entries.length} counts`,
    warning,
    synced_count: syncedEntries.length,
    failed_entries: failedEntries.length > 0 ? failedEntries : undefined,
    entries_count: entries.length,
  });
}

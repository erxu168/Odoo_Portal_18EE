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
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import {
  initInventoryTables,
  getSession,
  getSessionEntries,
  updateSessionStatus,
} from '@/lib/inventory-db';


export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { session_id, review_note } = body;
  if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const session = getSession(session_id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (session.status !== 'submitted') {
    return NextResponse.json({ error: 'Session must be in submitted status' }, { status: 400 });
  }

  const entries = getSessionEntries(session_id);
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No count entries to approve' }, { status: 400 });
  }

  // Sync to Odoo FIRST — only mark approved after success
  const syncedEntries: number[] = [];
  const failedEntries: { product_id: number; error: string }[] = [];

  try {
    const odoo = getOdoo();

    for (const entry of entries) {
      try {
        const quants = await odoo.searchRead('stock.quant', [
          ['product_id', '=', entry.product_id],
          ['location_id', '=', session.location_id],
        ], ['id', 'quantity'], { limit: 1 });

        if (quants.length > 0) {
          await odoo.write('stock.quant', [quants[0].id], {
            inventory_quantity: entry.counted_qty,
          });
        } else {
          await odoo.create('stock.quant', {
            product_id: entry.product_id,
            location_id: session.location_id,
            inventory_quantity: entry.counted_qty,
          });
        }
        syncedEntries.push(entry.product_id);
      } catch (entryErr: unknown) {
        const msg = entryErr instanceof Error ? entryErr.message : String(entryErr);
        console.error(`Odoo inventory write failed for product ${entry.product_id}:`, msg);
        failedEntries.push({ product_id: entry.product_id, error: msg });
      }
    }

    // Only apply inventory if at least some entries synced
    if (syncedEntries.length > 0) {
      const allQuants = await odoo.searchRead('stock.quant', [
        ['location_id', '=', session.location_id],
        ['inventory_quantity_set', '=', true],
      ], ['id'], { limit: 1000 });

      if (allQuants.length > 0) {
        const quantIds = allQuants.map((q: { id: number }) => q.id);
        await odoo.call('stock.quant', 'action_apply_inventory', [quantIds]);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Odoo inventory sync failed entirely:', msg);
    // Do NOT mark session as approved if Odoo connection failed entirely
    return NextResponse.json({
      error: `Odoo sync failed — session NOT approved: ${msg}`,
      synced_count: syncedEntries.length,
      failed_count: entries.length - syncedEntries.length,
    }, { status: 502 });
  }

  // If ALL entries failed individually, do not approve
  if (syncedEntries.length === 0) {
    return NextResponse.json({
      error: 'All Odoo writes failed — session NOT approved',
      failed_entries: failedEntries,
    }, { status: 502 });
  }

  // Mark session as approved AFTER Odoo sync (fully or partially)
  updateSessionStatus(session_id, 'approved', {
    reviewed_by: user.id,
    review_note,
  });

  const odooWarning = failedEntries.length > 0
    ? `Approved but ${failedEntries.length} of ${entries.length} entries failed to sync to Odoo`
    : null;

  return NextResponse.json({
    message: odooWarning || `Approved ${entries.length} counts`,
    warning: odooWarning,
    synced_count: syncedEntries.length,
    failed_entries: failedEntries.length > 0 ? failedEntries : undefined,
    entries_count: entries.length,
  });
}

/**
 * POST /api/inventory/approve
 *
 * Manager/Admin approves a counting session.
 * Writes inventory_quantity to stock.quant in Odoo 18 EE,
 * then calls apply_inventory to commit the adjustment.
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

initInventoryTables();

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden — manager role required' }, { status: 403 });
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

  try {
    const odoo = getOdoo();

    // For each entry, find or create the stock.quant, set inventory_quantity
    for (const entry of entries) {
      // Find existing quant
      const quants = await odoo.searchRead('stock.quant', [
        ['product_id', '=', entry.product_id],
        ['location_id', '=', session.location_id],
      ], ['id', 'quantity'], { limit: 1 });

      if (quants.length > 0) {
        // Write counted quantity
        await odoo.write('stock.quant', [quants[0].id], {
          inventory_quantity: entry.counted_qty,
        });
      } else {
        // No quant exists — create one with inventory adjustment
        // Odoo will create the quant when we set inventory_quantity
        // via the action_apply_inventory on the model
        const newId = await odoo.create('stock.quant', {
          product_id: entry.product_id,
          location_id: session.location_id,
          inventory_quantity: entry.counted_qty,
        });
      }
    }

    // Apply all inventory adjustments at this location
    const allQuants = await odoo.searchRead('stock.quant', [
      ['location_id', '=', session.location_id],
      ['inventory_quantity_set', '=', true],
    ], ['id'], { limit: 1000 });

    if (allQuants.length > 0) {
      const quantIds = allQuants.map((q: any) => q.id);
      await odoo.call('stock.quant', 'action_apply_inventory', [quantIds]);
    }

    // Mark session as approved in portal DB
    updateSessionStatus(session_id, 'approved', {
      reviewed_by: user.id,
      review_note,
    });

    return NextResponse.json({
      message: `Approved ${entries.length} counts — inventory updated in Odoo`,
      entries_count: entries.length,
    });

  } catch (err: any) {
    console.error('Inventory approve error:', err.message);
    return NextResponse.json({ error: `Odoo write failed: ${err.message}` }, { status: 500 });
  }
}

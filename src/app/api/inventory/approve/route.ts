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

initInventoryTables();

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

  // Update status FIRST so it's approved even if Odoo write fails
  updateSessionStatus(session_id, 'approved', {
    reviewed_by: user.id,
    review_note,
  });

  let odooWarning: string | null = null;

  try {
    const odoo = getOdoo();

    for (const entry of entries) {
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
    }

    const allQuants = await odoo.searchRead('stock.quant', [
      ['location_id', '=', session.location_id],
      ['inventory_quantity_set', '=', true],
    ], ['id'], { limit: 1000 });

    if (allQuants.length > 0) {
      const quantIds = allQuants.map((q: any) => q.id);
      await odoo.call('stock.quant', 'action_apply_inventory', [quantIds]);
    }
  } catch (err: any) {
    console.error('Odoo inventory write failed (session still approved):', err.message);
    odooWarning = `Approved but Odoo sync failed: ${err.message}`;
  }

  return NextResponse.json({
    message: odooWarning || `Approved ${entries.length} counts`,
    warning: odooWarning,
    entries_count: entries.length,
  });
}

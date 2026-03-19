/**
 * POST /api/inventory/quick-count/approve
 *
 * Manager approves a single quick count.
 * Writes inventory_quantity to stock.quant in Odoo.
 *
 * Body: { id: number }
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, approveQuickCount } from '@/lib/inventory-db';
import { getDb } from '@/lib/db';

initInventoryTables();

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Get the quick count record
  const db = getDb();
  const qc = db.prepare('SELECT * FROM quick_counts WHERE id = ?').get(id) as any;
  if (!qc) return NextResponse.json({ error: 'Quick count not found' }, { status: 404 });
  if (qc.status !== 'pending') {
    return NextResponse.json({ error: 'Already processed' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();

    // Find existing quant
    const quants = await odoo.searchRead('stock.quant', [
      ['product_id', '=', qc.product_id],
      ['location_id', '=', qc.location_id],
    ], ['id'], { limit: 1 });

    if (quants.length > 0) {
      await odoo.write('stock.quant', [quants[0].id], {
        inventory_quantity: qc.counted_qty,
      });
    } else {
      await odoo.create('stock.quant', {
        product_id: qc.product_id,
        location_id: qc.location_id,
        inventory_quantity: qc.counted_qty,
      });
    }

    // Apply inventory
    const toApply = await odoo.searchRead('stock.quant', [
      ['product_id', '=', qc.product_id],
      ['location_id', '=', qc.location_id],
      ['inventory_quantity_set', '=', true],
    ], ['id'], { limit: 10 });

    if (toApply.length > 0) {
      await odoo.call('stock.quant', 'action_apply_inventory', [toApply.map((q: any) => q.id)]);
    }

    // Update portal DB
    approveQuickCount(id, user.id);

    return NextResponse.json({ message: 'Quick count approved and applied to Odoo' });
  } catch (err: any) {
    console.error('QC approve error:', err.message);
    return NextResponse.json({ error: `Odoo write failed: ${err.message}` }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/quick-count/approve
 *
 * Manager approves a single quick count.
 * Updates status FIRST, then attempts Odoo write.
 *
 * Body: { id: number }
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, approveQuickCount } from '@/lib/inventory-db';
import { getDb } from '@/lib/db';
import { isUnrestrictedAdmin, canAccessCompany } from '@/lib/inventory-access';


export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.review.approve', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  initInventoryTables();
  const body = await request.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const qc = db.prepare('SELECT * FROM quick_counts WHERE id = ?').get(id) as any;
  if (!qc) return NextResponse.json({ error: 'Quick count not found' }, { status: 404 });
  if (qc.status !== 'pending') {
    return NextResponse.json({ error: 'Already processed' }, { status: 400 });
  }
  // Company ownership: only someone allowed this count's restaurant may approve it.
  // A null-company legacy row (not yet backfilled) is approvable only by an
  // unrestricted admin, so a manager can never approve another restaurant's count.
  const okCompany = qc.company_id == null ? isUnrestrictedAdmin(user) : canAccessCompany(user, qc.company_id);
  if (!okCompany) return NextResponse.json({ error: 'This count belongs to another restaurant' }, { status: 403 });

  // Update status FIRST so it's approved even if Odoo write fails
  approveQuickCount(id, user.id);

  let warning: string | null = null;

  try {
    const odoo = getOdoo();

    // Guard against a location that changed company since the count: only push to
    // Odoo when the location still belongs to this count's restaurant.
    if (qc.company_id != null) {
      const locRows = await odoo.searchRead('stock.location', [['id', '=', qc.location_id]], ['company_id'], { limit: 1 });
      const locCompany = locRows[0] && Array.isArray(locRows[0].company_id) ? locRows[0].company_id[0] : (locRows[0] ? locRows[0].company_id : false);
      // Only push to Odoo when the location STILL belongs to exactly this count's
      // restaurant. A shared (company_id=false) or missing location fails closed —
      // no stock write to a location whose ownership can't be confirmed.
      if (!locCompany || locCompany !== qc.company_id) {
        return NextResponse.json({
          message: 'Approved and recorded. Stock not updated — this location is no longer tied to this restaurant.',
          warning: 'location-company-mismatch',
        });
      }
    }

    const quants = await odoo.searchRead('stock.quant', [
      ['product_id', '=', qc.product_id],
      ['location_id', '=', qc.location_id],
    ], ['id'], { limit: 2 });

    if (quants.length > 1) {
      // Several stock records (lot / package / owner dimensions) — don't guess which.
      warning = 'Approved. Stock not updated — several stock records exist for this product at the location; adjust it directly in Odoo.';
    } else {
      let quantId: number;
      if (quants.length === 1) {
        quantId = quants[0].id;
        await odoo.write('stock.quant', [quantId], {
          inventory_quantity: qc.counted_qty,
          inventory_quantity_set: true,
        });
      } else {
        quantId = await odoo.create('stock.quant', {
          product_id: qc.product_id,
          location_id: qc.location_id,
          inventory_quantity: qc.counted_qty,
          inventory_quantity_set: true,
        }) as number;
      }
      // Apply ONLY the quant we just wrote — never sweep other pending adjustments.
      await odoo.call('stock.quant', 'action_apply_inventory', [[quantId]]);
    }
  } catch (err: any) {
    console.error('QC Odoo write failed (still approved):', err.message);
    warning = `Approved but Odoo sync failed: ${err.message}`;
  }

  return NextResponse.json({
    message: warning || 'Quick count approved',
    warning,
  });
}

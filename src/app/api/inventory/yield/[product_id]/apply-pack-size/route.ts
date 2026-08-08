export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/yield/[product_id]/apply-pack-size
 *
 * Replace a product's typed pack size with the one its yield tests measured.
 *
 * A DEDICATED endpoint rather than the generic product-flags PUT, for three
 * reasons the generic one cannot give:
 *
 *  1. The number is re-derived HERE from the stored tests. The browser sends no
 *     figure at all, so a stale tab — or a bug in it — cannot write a pack size
 *     that no measurement supports.
 *  2. Every guard is re-checked server-side: weight base unit, somebody has
 *     confirmed the pack varies, enough tests. The screen decides what to SHOW;
 *     this decides what may be WRITTEN.
 *  3. The size change and the par rescale happen in ONE transaction, so a
 *     restaurant can never end up with the new size and the old par.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { moduleForbidden } from '@/lib/module-access';
import {
  initInventoryTables, getYieldTests, getProductFlags, applyMeasuredPackSize,
  type YieldTestRow,
} from '@/lib/inventory-db';
import { summarise, packOffer, type YieldTest } from '@/lib/yield';
import { getOdoo } from '@/lib/odoo';

export async function POST(request: Request, { params }: { params: { product_id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.product_id, 10);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    initInventoryTables();

    // The unit of measure decides whether a pack size is a measurement at all,
    // so it has to come from Odoo — not from the caller.
    let uom = '';
    try {
      const rows = await getOdoo().searchRead('product.product', [['id', '=', productId]], ['uom_id'], { limit: 1 });
      const u = (rows as { uom_id?: [number, string] }[])[0]?.uom_id;
      uom = Array.isArray(u) ? u[1] : '';
    } catch {
      return NextResponse.json(
        { error: 'Could not reach Odoo to check the unit of measure. Nothing was changed.' },
        { status: 503 },
      );
    }

    const flags = getProductFlags([productId])[0];
    const tests = getYieldTests(productId);
    const summary = summarise(tests.map((r: YieldTestRow): YieldTest => ({ ...r })));
    const offer = packOffer(uom, flags?.units_per_crate, summary, flags?.pack_varies);

    // Re-checked, not re-stated: whatever the screen was showing, the write only
    // happens if the measurements still justify it right now.
    if (!offer) {
      return NextResponse.json(
        { error: 'The tests no longer support changing the pack size. Reload the product.' },
        { status: 409 },
      );
    }

    const { parsRescaled, conflict } = applyMeasuredPackSize(
      productId, flags?.units_per_crate ?? null, offer.measured, user.id,
    );
    // Somebody changed the pack size between the read above and the write. The
    // transaction refused rather than overwrite them and rescale pars by a
    // divisor that is no longer true.
    if (conflict) {
      return NextResponse.json(
        { error: 'Somebody else changed the pack size just now. Reload the product and look again.' },
        { status: 409 },
      );
    }
    console.info('[yield] pack size %s -> %s for product %s by user %s (%d pars rescaled)',
      flags?.units_per_crate ?? 'unset', offer.measured, productId, user.id, parsRescaled);

    return NextResponse.json({ success: true, units_per_crate: offer.measured, parsRescaled });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[yield apply-pack-size]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

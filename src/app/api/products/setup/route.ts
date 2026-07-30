/**
 * GET /api/products/setup — the products waiting to be finished.
 *
 * A barcode nobody recognised was scanned during a count. Rather than blocking
 * the count, the portal creates the product there and then, inactive, with only
 * that barcode and whatever the person typed as a name. It stays out of counts,
 * orders and the till until a manager finishes it or rejects it — and this is
 * the list of those.
 *
 * Reads the drafts table FIRST and looks up those exact ids, rather than
 * filtering the catalog. The catalog applies a relevance filter — a shared
 * product is only listed for a restaurant that already uses it — and a draft has
 * no stock, no order and is on no list, so it is invisible there by definition.
 * Asking "which drafts exist" and then "what are they" cannot have that problem.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, listPendingDrafts } from '@/lib/inventory-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // The SAME capability the three resolving endpoints require
  // (approve / link / reject all check inventory.draft.review). Gating the list
  // on the catalog-management capability instead would let somebody in to a
  // screen whose every button returns 403, and keep out somebody who was
  // deliberately granted draft review.
  if (!roleCan(user.role, 'inventory.draft.review', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Draft review access required' }, { status: 403 });
  }
  initInventoryTables();

  const drafts = listPendingDrafts();
  if (drafts.length === 0) return NextResponse.json({ drafts: [] });

  try {
    const odoo = getOdoo();
    const rows = await odoo.searchRead('product.product',
      [['id', 'in', drafts.map((d) => d.odoo_product_id)]],
      ['id', 'name', 'barcode', 'categ_id', 'uom_id', 'active', 'is_storable'],
      // active_test off: a draft IS inactive, which is the whole point.
      { limit: drafts.length, context: { active_test: false } });

    const byId = new Map(rows.map((r: { id: number }) => [r.id, r]));
    return NextResponse.json({
      drafts: drafts.map((d) => {
        const p = byId.get(d.odoo_product_id) as Record<string, unknown> | undefined;
        return {
          id: d.odoo_product_id,
          barcode: d.barcode,
          scanned_at: d.created_at,
          scanned_by: d.created_by,
          // A draft whose Odoo record is gone — deleted directly in Odoo — is
          // reported rather than hidden, so the row can offer to clear it
          // instead of silently vanishing from a count it is still on.
          missing: !p,
          name: p ? String(p.name ?? '') : null,
          categ_id: p?.categ_id ?? null,
          uom_id: p?.uom_id ?? null,
          // Already activated in Odoo but still pending here: the sign of an
          // approval that half-completed. Worth showing, because the fix is to
          // approve it again rather than to wonder why it is in two states.
          already_active: p ? p.active === true : false,
        };
      }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not load the setup queue';
    console.error('[products/setup]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

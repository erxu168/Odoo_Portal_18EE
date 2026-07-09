export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/consumption?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * How much of each count-list ingredient was CONSUMED in the period, read from
 * Odoo stock moves (outflow from an internal/stock location to a non-internal
 * one = production/prep + POS/sales). Manager+ only.
 *
 * Note: this is recipe/production-based usage — it does NOT include waste or
 * cook-to-order items that never run through a recipe. Scoped to products that
 * appear in the counting lists so it stays fast and relevant.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, listTemplates } from '@/lib/inventory-db';

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.consumption.view', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const ok = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(from) || !ok(to)) {
    return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
  }

  initInventoryTables();
  const ids = Array.from(new Set(listTemplates().flatMap(t => t.product_ids))).filter(Boolean) as number[];
  if (ids.length === 0) return NextResponse.json({ from, to, items: [] });

  try {
    const odoo = getOdoo();
    const LIMIT = 20000;
    const moves = await odoo.searchRead('stock.move', [
      ['product_id', 'in', ids],
      ['state', '=', 'done'],
      ['date', '>=', `${from} 00:00:00`],
      ['date', '<=', `${to} 23:59:59`],
      ['location_id.usage', '=', 'internal'],
      ['location_dest_id.usage', '!=', 'internal'],
    ], ['product_id', 'product_uom_qty', 'product_uom', 'location_dest_id'], { limit: LIMIT });

    type Row = { product_id: number; name: string; uom: string; total: number; prep: number; sales: number };
    const agg = new Map<number, Row>();
    for (const m of moves) {
      const pid = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
      if (!pid) continue;
      const name = Array.isArray(m.product_id) ? m.product_id[1] : String(pid);
      const uom = Array.isArray(m.product_uom) ? m.product_uom[1] : '';
      const dest = (Array.isArray(m.location_dest_id) ? m.location_dest_id[1] : '') || '';
      const qty = Number(m.product_uom_qty) || 0;
      let row = agg.get(pid);
      if (!row) { row = { product_id: pid, name, uom, total: 0, prep: 0, sales: 0 }; agg.set(pid, row); }
      row.total += qty;
      if (/customer|pos/i.test(dest)) row.sales += qty;
      else row.prep += qty;
    }

    const items = Array.from(agg.values())
      .filter(r => r.total > 0.0001)
      .map(r => ({ product_id: r.product_id, name: r.name, uom: r.uom, total: round2(r.total), prep: round2(r.prep), sales: round2(r.sales) }))
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({ from, to, items, truncated: moves.length >= LIMIT });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[consumption]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

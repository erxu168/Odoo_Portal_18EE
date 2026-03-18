import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const odoo = getOdoo();
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    // Build domain filter
    const domain: any[] = [['active', '=', true]];
    if (search) {
      domain.push(['product_tmpl_id.name', 'ilike', search]);
    }

    // ── 1. Fetch all BOMs in one call ──────────────────────────────────────
    const boms = await odoo.searchRead('mrp.bom', domain, [
      'product_tmpl_id',
      'product_id',
      'product_qty',
      'product_uom_id',
      'bom_line_ids',
      'type',
      'code',
    ], { order: 'product_tmpl_id asc' });

    // ── 2. Batch-fetch ALL BOM lines in one call ──────────────────────────
    const allLineIds: number[] = [];
    for (const bom of boms) {
      allLineIds.push(...(bom.bom_line_ids || []));
    }

    const allLines = allLineIds.length
      ? await odoo.read('mrp.bom.line', allLineIds, [
          'product_id',
          'product_qty',
          'product_uom_id',
          'bom_id',
        ])
      : [];

    // Index lines by BOM id
    const linesByBomId: Record<number, any[]> = {};
    for (const line of allLines) {
      const bomId = Array.isArray(line.bom_id) ? line.bom_id[0] : line.bom_id;
      if (!linesByBomId[bomId]) linesByBomId[bomId] = [];
      linesByBomId[bomId].push(line);
    }

    // ── 3. Batch-fetch ALL stock quants in one call ───────────────────────
    const allProductIds = new Set<number>();
    for (const line of allLines) {
      if (line.product_id) allProductIds.add(line.product_id[0]);
    }

    const quants = allProductIds.size > 0
      ? await odoo.searchRead(
          'stock.quant',
          [
            ['product_id', 'in', Array.from(allProductIds)],
            ['location_id.usage', '=', 'internal'],
          ],
          ['product_id', 'quantity', 'reserved_quantity'],
        )
      : [];

    // Build global stock map: product_id -> available qty
    const stockMap: Record<number, number> = {};
    for (const q of quants) {
      const pid = q.product_id[0];
      stockMap[pid] = (stockMap[pid] || 0) + (q.quantity - q.reserved_quantity);
    }

    // ── 4. Batch-fetch ALL product template categories in one call ────────
    const tmplIds = new Set<number>();
    for (const bom of boms) {
      if (bom.product_tmpl_id) tmplIds.add(bom.product_tmpl_id[0]);
    }

    const templates = tmplIds.size > 0
      ? await odoo.searchRead(
          'product.template',
          [['id', 'in', Array.from(tmplIds)]],
          ['id', 'categ_id'],
        )
      : [];

    const categByTmplId: Record<number, string> = {};
    for (const t of templates) {
      categByTmplId[t.id] = t.categ_id?.[1] || 'Uncategorized';
    }

    // ── 5. Assemble enriched data ─────────────────────────────────────────
    const enriched = boms.map((bom: any) => {
      const lines = linesByBomId[bom.id] || [];

      // Calculate availability status
      let worstStatus: 'ok' | 'low' | 'out' = 'ok';
      let canMakeQty = Infinity;
      let hasAnyStock = false;

      for (const line of lines) {
        const pid = line.product_id[0];
        const available = stockMap[pid] || 0;
        const required = line.product_qty;
        const ratio = bom.product_qty > 0 ? required / bom.product_qty : 0;

        if (available > 0) hasAnyStock = true;

        if (ratio > 0) {
          const maxFromThis = available / ratio;
          canMakeQty = Math.min(canMakeQty, maxFromThis);
        }

        if (available <= 0) {
          worstStatus = 'out';
        } else if (available < required * 1.5 && worstStatus !== 'out') {
          worstStatus = 'low';
        }
      }

      if (canMakeQty === Infinity) canMakeQty = 0;

      // If no stock data exists at all, mark as 'none' instead of 'out'
      // This distinguishes "no inventory tracked" from "out of stock"
      const availStatus = lines.length === 0
        ? 'ok'
        : !hasAnyStock
          ? 'none'
          : worstStatus;

      const categName = categByTmplId[bom.product_tmpl_id[0]] || 'Uncategorized';

      return {
        ...bom,
        component_count: lines.length,
        availability_status: availStatus,
        can_make_qty: Math.floor(canMakeQty * 100) / 100,
        category: categName,
      };
    });

    // Filter by category if specified
    const filtered = category
      ? enriched.filter((b: any) =>
          b.category.toLowerCase().includes(category.toLowerCase()),
        )
      : enriched;

    return NextResponse.json({ boms: filtered, total: filtered.length });
  } catch (error: any) {
    console.error('GET /api/boms error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch BOMs' },
      { status: 500 },
    );
  }
}

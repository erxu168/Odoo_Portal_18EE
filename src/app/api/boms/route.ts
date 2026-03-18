import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

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

    // Fetch BOMs
    const boms = await odoo.searchRead('mrp.bom', domain, [
      'product_tmpl_id',
      'product_id',
      'product_qty',
      'product_uom_id',
      'bom_line_ids',
      'type',
      'code',
    ], { order: 'product_tmpl_id asc' });

    // Get component counts and stock availability per BOM
    const enriched = await Promise.all(
      boms.map(async (bom: any) => {
        // Fetch BOM lines to count components
        const lines = await odoo.read('mrp.bom.line', bom.bom_line_ids, [
          'product_id',
          'product_qty',
          'product_uom_id',
        ]);

        // Get stock for each component product
        const productIds = lines.map((l: any) => l.product_id[0]);
        const quants = productIds.length
          ? await odoo.searchRead(
              'stock.quant',
              [
                ['product_id', 'in', productIds],
                ['location_id.usage', '=', 'internal'],
              ],
              ['product_id', 'quantity', 'reserved_quantity'],
            )
          : [];

        // Build stock map: product_id -> available qty
        const stockMap: Record<number, number> = {};
        for (const q of quants) {
          const pid = q.product_id[0];
          stockMap[pid] = (stockMap[pid] || 0) + (q.quantity - q.reserved_quantity);
        }

        // Calculate availability status and max producible
        let worstStatus: 'ok' | 'low' | 'out' = 'ok';
        let canMakeQty = Infinity;

        for (const line of lines) {
          const pid = line.product_id[0];
          const available = stockMap[pid] || 0;
          const required = line.product_qty;
          const ratio = bom.product_qty > 0 ? required / bom.product_qty : 0;

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

        // Get category from product template
        const productTmpl = await odoo.searchRead(
          'product.template',
          [['id', '=', bom.product_tmpl_id[0]]],
          ['categ_id'],
          { limit: 1 },
        );
        const categName = productTmpl[0]?.categ_id?.[1] || 'Uncategorized';

        return {
          ...bom,
          component_count: lines.length,
          availability_status: worstStatus,
          can_make_qty: Math.floor(canMakeQty * 100) / 100,
          category: categName,
        };
      }),
    );

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

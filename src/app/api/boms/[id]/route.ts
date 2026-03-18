import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import type { ComponentAvailability } from '@/types/manufacturing';

/**
 * Recursively resolve BOM lines, including sub-BOMs
 */
async function resolveBomLines(
  odoo: ReturnType<typeof getOdoo>,
  bomLineIds: number[],
  stockMap: Record<number, number>,
  parentQtyRatio: number = 1,
): Promise<ComponentAvailability[]> {
  if (!bomLineIds.length) return [];

  const lines = await odoo.read('mrp.bom.line', bomLineIds, [
    'product_id',
    'product_qty',
    'product_uom_id',
    'child_bom_id',
    'child_line_ids',
  ]);

  const components: ComponentAvailability[] = [];

  for (const line of lines) {
    const pid = line.product_id[0];
    const requiredQty = line.product_qty * parentQtyRatio;
    const onHand = stockMap[pid] || 0;
    const hasSubBom = line.child_bom_id && line.child_bom_id[0];

    let subBomLines: ComponentAvailability[] = [];

    if (hasSubBom) {
      // Fetch the sub-BOM's lines
      const subBom = await odoo.read('mrp.bom', [line.child_bom_id[0]], [
        'bom_line_ids',
        'product_qty',
      ]);
      if (subBom[0]) {
        const subRatio = requiredQty / (subBom[0].product_qty || 1);
        subBomLines = await resolveBomLines(
          odoo,
          subBom[0].bom_line_ids,
          stockMap,
          subRatio,
        );
      }
    }

    let status: 'ok' | 'low' | 'out' = 'ok';
    if (onHand <= 0) status = 'out';
    else if (onHand < requiredQty * 1.5) status = 'low';

    components.push({
      product_id: pid,
      product_name: line.product_id[1],
      required_qty: Math.round(requiredQty * 1000) / 1000,
      on_hand_qty: Math.round(onHand * 1000) / 1000,
      uom: line.product_uom_id[1],
      status,
      is_sub_bom: !!hasSubBom,
      sub_bom_id: hasSubBom ? line.child_bom_id[0] : undefined,
      sub_bom_lines: subBomLines.length ? subBomLines : undefined,
    });
  }

  return components;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const odoo = getOdoo();
    const bomId = parseInt(params.id);

    // Fetch the BOM
    const boms = await odoo.read('mrp.bom', [bomId], [
      'product_tmpl_id',
      'product_id',
      'product_qty',
      'product_uom_id',
      'bom_line_ids',
      'type',
      'code',
    ]);

    if (!boms.length) {
      return NextResponse.json({ error: 'BOM not found' }, { status: 404 });
    }

    const bom = boms[0];

    // Fetch all BOM lines
    const lines = await odoo.read('mrp.bom.line', bom.bom_line_ids, [
      'product_id',
      'product_qty',
      'product_uom_id',
      'child_bom_id',
    ]);

    // Collect all product IDs (including sub-BOM products) for stock lookup
    const allProductIds = new Set<number>();
    const collectProductIds = async (lineIds: number[]) => {
      const ls = await odoo.read('mrp.bom.line', lineIds, [
        'product_id',
        'child_bom_id',
        'child_line_ids',
      ]);
      for (const l of ls) {
        allProductIds.add(l.product_id[0]);
        if (l.child_bom_id && l.child_bom_id[0]) {
          const subBom = await odoo.read('mrp.bom', [l.child_bom_id[0]], [
            'bom_line_ids',
          ]);
          if (subBom[0]?.bom_line_ids?.length) {
            await collectProductIds(subBom[0].bom_line_ids);
          }
        }
      }
    };
    await collectProductIds(bom.bom_line_ids);

    // Fetch stock for all products at once
    const quants = allProductIds.size
      ? await odoo.searchRead(
          'stock.quant',
          [
            ['product_id', 'in', Array.from(allProductIds)],
            ['location_id.usage', '=', 'internal'],
          ],
          ['product_id', 'quantity', 'reserved_quantity'],
        )
      : [];

    const stockMap: Record<number, number> = {};
    for (const q of quants) {
      const pid = q.product_id[0];
      stockMap[pid] = (stockMap[pid] || 0) + (q.quantity - q.reserved_quantity);
    }

    // Resolve all components with sub-BOMs
    const components = await resolveBomLines(odoo, bom.bom_line_ids, stockMap);

    // Calculate max producible quantity
    let canMakeQty = Infinity;
    for (const comp of components) {
      if (comp.required_qty > 0) {
        const maxFromThis =
          (comp.on_hand_qty / comp.required_qty) * bom.product_qty;
        canMakeQty = Math.min(canMakeQty, maxFromThis);
      }
    }
    if (canMakeQty === Infinity) canMakeQty = 0;

    // Fetch last production date
    const lastMo = await odoo.searchRead(
      'mrp.production',
      [
        ['bom_id', '=', bomId],
        ['state', '=', 'done'],
      ],
      ['date_finished'],
      { limit: 1, order: 'date_finished desc' },
    );

    return NextResponse.json({
      bom: {
        ...bom,
        component_count: components.length,
        last_produced: lastMo[0]?.date_finished || null,
      },
      components,
      can_make_qty: Math.floor(canMakeQty * 100) / 100,
    });
  } catch (error: any) {
    console.error(`GET /api/boms/${params.id} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch BOM detail' },
      { status: 500 },
    );
  }
}

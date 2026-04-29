import { NextRequest, NextResponse } from 'next/server';
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

    const boms = await odoo.read('mrp.bom', [bomId], [
      'product_tmpl_id',
      'product_id',
      'product_qty',
      'product_uom_id',
      'bom_line_ids',
      'type',
      'code',
      'company_id',
      'operation_ids',
    ]);

    if (!boms.length) {
      return NextResponse.json({ error: 'BOM not found' }, { status: 404 });
    }

    const bom = boms[0];

    let resolvedProductId = bom.product_id ? bom.product_id[0] : null;
    if (!resolvedProductId && bom.product_tmpl_id) {
      const variants = await odoo.searchRead(
        'product.product',
        [['product_tmpl_id', '=', bom.product_tmpl_id[0]]],
        ['id'],
        { limit: 1 },
      );
      if (variants.length > 0) {
        resolvedProductId = variants[0].id;
      }
    }

    // Fetch operations — include all worksheet fields
    const operations = bom.operation_ids?.length
      ? await odoo.read('mrp.routing.workcenter', bom.operation_ids, [
          'id', 'name', 'workcenter_id', 'sequence', 'time_cycle_manual',
          'note', 'worksheet_type', 'worksheet_google_slide',
        ])
      : [];

    const lines = await odoo.read('mrp.bom.line', bom.bom_line_ids, [
      'product_id',
      'product_qty',
      'product_uom_id',
      'child_bom_id',
    ]);

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

    const catProducts = allProductIds.size
      ? await odoo.read('product.product', Array.from(allProductIds), ['categ_id'])
      : [];
    const categMap: Record<number, string> = {};
    for (const p of catProducts) {
      const fullName = p.categ_id?.[1] || 'Other';
      const parts = fullName.split(' / ');
      categMap[p.id] = parts[parts.length - 1];
    }

    const components = await resolveBomLines(odoo, bom.bom_line_ids, stockMap);

    for (const comp of components) {
      (comp as any).category = categMap[comp.product_id] || 'Other';
    }

    let canMakeQty = Infinity;
    for (const comp of components) {
      if (comp.required_qty > 0) {
        const maxFromThis =
          (comp.on_hand_qty / comp.required_qty) * bom.product_qty;
        canMakeQty = Math.min(canMakeQty, maxFromThis);
      }
    }
    if (canMakeQty === Infinity) canMakeQty = 0;

    const lastMo = await odoo.searchRead(
      'mrp.production',
      [
        ['bom_id', '=', bomId],
        ['state', '=', 'done'],
      ],
      ['date_finished'],
      { limit: 1, order: 'date_finished desc' },
    );

    let shelfLifeDays = 0;
    if (bom.product_tmpl_id?.[0]) {
      const tmpl = await odoo.read('product.template', [bom.product_tmpl_id[0]], [
        'use_expiration_date', 'expiration_time',
      ]);
      if (tmpl[0]?.use_expiration_date) {
        shelfLifeDays = tmpl[0].expiration_time || 0;
      }
    }

    return NextResponse.json({
      bom: {
        ...bom,
        resolved_product_id: resolvedProductId,
        component_count: components.length,
        last_produced: lastMo[0]?.date_finished || null,
        shelf_life_days: shelfLifeDays,
      },
      components,
      can_make_qty: Math.floor(canMakeQty * 100) / 100,
      operations: operations.sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0)),
    });
  } catch (error: any) {
    console.error(`GET /api/boms/${params.id} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch BOM detail' },
      { status: 500 },
    );
  }
}


/**
 * PATCH /api/boms/:id
 * Edit a BOM: lines + operations with full worksheet support.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const bomId = parseInt(params.id);
    const odoo = getOdoo();
    const body = await req.json();

    // Update BOM output qty
    if (body.product_qty !== undefined) {
      await odoo.write('mrp.bom', [bomId], { product_qty: body.product_qty });
    }

    // Update existing line quantities
    if (body.update_lines?.length) {
      for (const line of body.update_lines) {
        await odoo.write('mrp.bom.line', [line.line_id], {
          product_qty: line.product_qty,
        });
      }
    }

    // Add new lines
    if (body.add_lines?.length) {
      for (const line of body.add_lines) {
        await odoo.create('mrp.bom.line', {
          bom_id: bomId,
          product_id: line.product_id,
          product_qty: line.product_qty,
          product_uom_id: line.product_uom_id,
        });
      }
    }

    // Remove lines
    if (body.remove_lines?.length) {
      for (const lineId of body.remove_lines) {
        await odoo.call('mrp.bom.line', 'unlink', [[lineId]]);
      }
    }

    // Update existing operations
    if (body.update_operations?.length) {
      for (const op of body.update_operations) {
        const vals: Record<string, unknown> = {};
        if (op.name !== undefined) vals.name = op.name;
        if (op.workcenter_id !== undefined) vals.workcenter_id = op.workcenter_id;
        if (op.time_cycle_manual !== undefined) vals.time_cycle_manual = op.time_cycle_manual;
        if (op.sequence !== undefined) vals.sequence = op.sequence;
        if (op.note !== undefined) vals.note = op.note || false;
        // Worksheet fields
        if (op.worksheet_type !== undefined) vals.worksheet_type = op.worksheet_type || false;
        if (op.worksheet !== undefined) {
          let fileData = op.worksheet || '';
          if (typeof fileData === 'string' && fileData.startsWith('data:')) {
            fileData = fileData.replace(/^data:[^;]+;base64,/, '');
          }
          vals.worksheet = fileData || false;
          if (fileData) vals.worksheet_type = 'pdf';
        }
        if (op.worksheet_google_slide !== undefined) {
          vals.worksheet_google_slide = op.worksheet_google_slide || false;
          if (op.worksheet_google_slide) vals.worksheet_type = 'google_slide';
        }
        if (Object.keys(vals).length) {
          await odoo.write('mrp.routing.workcenter', [op.operation_id], vals);
        }
      }
    }

    // Add new operations
    if (body.add_operations?.length) {
      for (const op of body.add_operations) {
        const createVals: Record<string, unknown> = {
          bom_id: bomId,
          name: op.name,
          workcenter_id: op.workcenter_id,
          time_cycle_manual: op.time_cycle_manual || 0,
          sequence: op.sequence || 10,
          note: op.note || false,
          worksheet_type: op.worksheet_type || false,
          worksheet_google_slide: op.worksheet_google_slide || false,
        };
        // Handle PDF worksheet
        if (op.worksheet) {
          let fileData = op.worksheet;
          if (typeof fileData === 'string' && fileData.startsWith('data:')) {
            fileData = fileData.replace(/^data:[^;]+;base64,/, '');
          }
          createVals.worksheet = fileData;
          createVals.worksheet_type = 'pdf';
        } else {
          createVals.worksheet = false;
        }
        await odoo.create('mrp.routing.workcenter', createVals);
      }
    }

    // Remove operations
    if (body.remove_operations?.length) {
      for (const opId of body.remove_operations) {
        await odoo.call('mrp.routing.workcenter', 'unlink', [[opId]]);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`PATCH /api/boms/${params.id} error:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

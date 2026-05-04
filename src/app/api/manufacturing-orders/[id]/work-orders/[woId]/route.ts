import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, requireRole, AuthError } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: { id: string; woId: string } },
) {
  try {
    requireAuth();
    const odoo = getOdoo();
    const woId = parseInt(params.woId);

    const wos = await odoo.read('mrp.workorder', [woId], [
      'name',
      'workcenter_id',
      'state',
      'duration_expected',
      'duration',
      'date_start',
      'date_finished',
      'sequence',
      'production_id',
      'move_raw_ids',
      // Worksheet fields
      'worksheet_type',
      'worksheet',
      'worksheet_google_slide',
      'operation_note',
    ]);

    if (!wos.length) {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
    }

    const wo = wos[0];

    let components: any[] = [];
    if (wo.move_raw_ids?.length) {
      components = await odoo.searchRead(
        'stock.move',
        [['id', 'in', wo.move_raw_ids]],
        ['product_id', 'product_uom_qty', 'quantity', 'product_uom',
         'forecast_availability', 'state'],
      );

      const productIds = components.map((c: any) => c.product_id[0]);
      const quants = productIds.length
        ? await odoo.searchRead('stock.quant',
            [['product_id', 'in', productIds], ['location_id.usage', '=', 'internal']],
            ['product_id', 'quantity', 'reserved_quantity'])
        : [];

      const stockMap: Record<number, number> = {};
      for (const q of quants) {
        const pid = q.product_id[0];
        stockMap[pid] = (stockMap[pid] || 0) + (q.quantity - q.reserved_quantity);
      }

      components = components.map((c: any) => ({
        ...c,
        on_hand_qty: stockMap[c.product_id[0]] || 0,
      }));
    }

    return NextResponse.json({
      work_order: { ...wo, components },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('GET /api/manufacturing-orders/[id]/work-orders/[woId] error:', error);
    return NextResponse.json({ error: 'Failed to fetch work order' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; woId: string } },
) {
  try {
    requireRole('manager');
    const odoo = getOdoo();
    const woId = parseInt(params.woId);
    const body = await request.json();

    if (body.action) {
      switch (body.action) {
        case 'start':
          await odoo.buttonCall('mrp.workorder', 'button_start', [woId]);
          break;
        case 'pause':
          await odoo.buttonCall('mrp.workorder', 'button_pending', [woId]);
          break;
        case 'done':
          await odoo.buttonCall('mrp.workorder', 'button_finish', [woId]);
          break;
        default:
          return NextResponse.json(
            { error: `Unknown action: ${body.action}` },
            { status: 400 },
          );
      }
    }

    if (body.component_updates) {
      for (const update of body.component_updates) {
        await odoo.write('stock.move', [update.move_id], {
          quantity: update.consumed_qty,
        });
      }
    }

    if (body.pick_updates) {
      for (const update of body.pick_updates) {
        await odoo.write('stock.move', [update.move_id], {
          picked: update.is_picked,
        });
      }
    }

    const updated = await odoo.read('mrp.workorder', [woId], [
      'name', 'state', 'duration', 'date_start',
    ]);

    return NextResponse.json({ work_order: updated[0] });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('PATCH /api/manufacturing-orders/[id]/work-orders/[woId] error:', error);
    return NextResponse.json({ error: 'Failed to update work order' }, { status: 500 });
  }
}

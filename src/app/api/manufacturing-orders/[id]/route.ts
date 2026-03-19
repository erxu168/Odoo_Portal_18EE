import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const odoo = getOdoo();
    const moId = parseInt(params.id);

    const mos = await odoo.read('mrp.production', [moId], [
      'name', 'product_id', 'product_qty', 'product_uom_id',
      'bom_id', 'state', 'date_start', 'date_finished',
      'date_deadline', 'user_id', 'qty_producing',
      'workorder_ids', 'move_raw_ids',
    ]);

    if (!mos.length) {
      return NextResponse.json({ error: 'MO not found' }, { status: 404 });
    }

    const mo = mos[0];

    const components = mo.move_raw_ids?.length
      ? await odoo.searchRead('stock.move',
          [['id', 'in', mo.move_raw_ids]],
          ['product_id', 'product_uom_qty', 'quantity', 'product_uom',
           'forecast_availability', 'state', 'is_done', 'should_consume_qty',
           'picked'])
      : [];

    const enrichedComponents = components.map((c: any) => ({
      ...c, consumed_qty: c.quantity || 0,
    }));

    const workOrders = mo.workorder_ids?.length
      ? await odoo.searchRead('mrp.workorder',
          [['id', 'in', mo.workorder_ids]],
          ['name', 'workcenter_id', 'state', 'duration_expected', 'duration',
           'date_start', 'date_finished', 'sequence', 'production_id', 'move_raw_ids'],
          { order: 'sequence asc' })
      : [];

    const doneWos = workOrders.filter((wo: any) => wo.state === 'done').length;
    const totalWos = workOrders.length;

    return NextResponse.json({
      order: {
        ...mo,
        components: enrichedComponents,
        work_orders: workOrders,
        progress_percent: totalWos > 0 ? Math.round((doneWos / totalWos) * 100) : 0,
      },
    });
  } catch (error: any) {
    console.error(`GET /api/manufacturing-orders/${params.id} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch MO' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const odoo = getOdoo();
    const moId = parseInt(params.id);
    const body = await request.json();

    if (body.action) {
      switch (body.action) {
        case 'confirm':
          await odoo.buttonCall('mrp.production', 'action_confirm', [moId]);
          break;
        case 'mark_done': {
          const result = await odoo.buttonCall('mrp.production', 'button_mark_done', [moId]);
          if (result && typeof result === 'object' && result.res_model) {
            try {
              const wizModel = result.res_model;
              const wizCtx = result.context || {};
              const ctx = { ...wizCtx, active_id: moId, active_ids: [moId] };
              const wizId = await odoo.create(wizModel, {}, { context: ctx });
              const wizIds = Array.isArray(wizId) ? wizId : [wizId];
              if (wizModel === 'mrp.immediate.production') {
                await odoo.call(wizModel, 'process', [wizIds]);
              } else if (wizModel === 'mrp.production.backorder') {
                try {
                  await odoo.call(wizModel, 'action_close_mo', [wizIds]);
                } catch {
                  await odoo.call(wizModel, 'process', [wizIds]);
                }
              } else {
                await odoo.call(wizModel, 'process', [wizIds]);
              }
            } catch (wizErr: any) {
              console.error('Wizard error:', wizErr.message);
            }
          }
          break;
        }
        case 'cancel':
          await odoo.buttonCall('mrp.production', 'action_cancel', [moId]);
          break;
        default:
          return NextResponse.json(
            { error: `Unknown action: ${body.action}` },
            { status: 400 },
          );
      }
    }

    if (body.vals) {
      await odoo.write('mrp.production', [moId], body.vals);
    }

    // Component quantity updates — also sets picked=true
    if (body.component_updates) {
      for (const update of body.component_updates) {
        await odoo.write('stock.move', [update.move_id], {
          quantity: update.consumed_qty,
          picked: true,
        });
      }
    }

    const updated = await odoo.read('mrp.production', [moId], [
      'name', 'state', 'product_qty', 'qty_producing',
    ]);

    return NextResponse.json({ order: updated[0] });
  } catch (error: any) {
    console.error(`PATCH /api/manufacturing-orders/${params.id} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to update MO' },
      { status: 500 },
    );
  }
}

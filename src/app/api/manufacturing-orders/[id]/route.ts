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
           'forecast_availability', 'state', 'is_done', 'should_consume_qty'])
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
          // button_mark_done may return a wizard action (e.g. mrp.immediate.production)
          // We need to handle that by processing the wizard
          const result = await odoo.buttonCall('mrp.production', 'button_mark_done', [moId]);

          // If result is an action dict (wizard), process it
          if (result && typeof result === 'object' && result.res_model) {
            try {
              // Create the wizard record
              const wizardModel = result.res_model;
              const wizardContext = result.context || {};

              if (wizardModel === 'mrp.immediate.production') {
                // Create the wizard with the MO context
                const wizId = await odoo.create(wizardModel, {}, {
                  context: { ...wizardContext, active_id: moId, active_ids: [moId] },
                });
                // Execute the wizard's confirm action
                await odoo.buttonCall(wizardModel, 'process', [wizId], {
                  context: { ...wizardContext, active_id: moId, active_ids: [moId] },
                });
              } else if (wizardModel === 'change.production.qty' || wizardModel === 'mrp.production.backorder') {
                // Handle backorder wizard — just confirm with no backorder
                const wizId = await odoo.create(wizardModel, {}, {
                  context: { ...wizardContext, active_id: moId, active_ids: [moId] },
                });
                // Try action_close or action_skip_backorder
                try {
                  await odoo.buttonCall(wizardModel, 'action_close_mo', [wizId], {
                    context: { ...wizardContext, active_id: moId, active_ids: [moId] },
                  });
                } catch {
                  // Fallback: try process
                  await odoo.buttonCall(wizardModel, 'process', [wizId], {
                    context: { ...wizardContext, active_id: moId, active_ids: [moId] },
                  });
                }
              }
            } catch (wizErr: any) {
              console.error('Wizard processing error:', wizErr.message);
              // If wizard fails, the MO might still be in to_close state
              // Try direct state change as fallback
              try {
                await odoo.buttonCall('mrp.production', 'button_mark_done', [moId]);
              } catch {
                // ignore secondary error
              }
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

    if (body.component_updates) {
      for (const update of body.component_updates) {
        await odoo.write('stock.move', [update.move_id], {
          quantity: update.consumed_qty,
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

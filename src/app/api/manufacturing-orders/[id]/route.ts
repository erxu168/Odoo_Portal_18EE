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

    // Fetch finished product expiration settings
    // These fields live on product.template, so we need to go through the variant
    let expirationTimeDays = 0;
    let useExpirationDate = false;
    try {
      // Step 1: get product_tmpl_id from product.product
      const variants = await odoo.read(
        'product.product',
        [mo.product_id[0]],
        ['product_tmpl_id'],
      );
      if (variants.length > 0 && variants[0].product_tmpl_id) {
        const tmplId = variants[0].product_tmpl_id[0];
        // Step 2: read expiration fields from product.template
        const templates = await odoo.read(
          'product.template',
          [tmplId],
          ['use_expiration_date', 'expiration_time'],
        );
        if (templates.length > 0) {
          useExpirationDate = !!templates[0].use_expiration_date;
          // expiration_time is stored in days (float)
          expirationTimeDays = templates[0].expiration_time || 0;
        }
      }
    } catch (err) {
      // Non-fatal: if fields don't exist, default to 0
      console.warn('Could not fetch product expiration fields:', err);
    }

    const components = mo.move_raw_ids?.length
      ? await odoo.searchRead('stock.move',
          [['id', 'in', mo.move_raw_ids]],
          ['product_id', 'product_uom_qty', 'quantity', 'product_uom',
           'forecast_availability', 'state', 'is_done', 'should_consume_qty',
           'picked', 'operation_id'])
      : [];

    // Fetch product categories for grouping
    const productIds = components.map((c: any) => c.product_id[0]);
    const products = productIds.length
      ? await odoo.read('product.product', productIds, ['categ_id'])
      : [];
    const categMap: Record<number, string> = {};
    for (const p of products) {
      const fullName = p.categ_id?.[1] || 'Other';
      // Extract last segment: 'All / RAW MATERIALS / Dry Goods' -> 'Dry Goods'
      const parts = fullName.split(' / ');
      categMap[p.id] = parts[parts.length - 1];
    }

    const enrichedComponents = components.map((c: any) => ({
      ...c,
      consumed_qty: c.quantity || 0,
      category: categMap[c.product_id[0]] || 'Other',
    }));

    const workOrders = mo.workorder_ids?.length
      ? await odoo.searchRead('mrp.workorder',
          [['id', 'in', mo.workorder_ids]],
          ['name', 'workcenter_id', 'state', 'duration_expected', 'duration',
           'date_start', 'date_finished', 'sequence', 'production_id',
           'move_raw_ids', 'operation_id'],
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
        // Expiration settings from finished product template
        use_expiration_date: useExpirationDate,
        expiration_time_days: expirationTimeDays,
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

    if (body.component_updates) {
      for (const update of body.component_updates) {
        await odoo.write('stock.move', [update.move_id], {
          quantity: update.consumed_qty,
          picked: update.consumed_qty > 0,
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

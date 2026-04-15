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
      'workorder_ids', 'move_raw_ids', 'lot_producing_id',
    ]);

    if (!mos.length) {
      return NextResponse.json({ error: 'MO not found' }, { status: 404 });
    }

    const mo = mos[0];

    // Fetch finished product expiration settings + tracking
    // These fields live on product.template, so we need to go through the variant
    let expirationTimeDays = 0;
    let useExpirationDate = false;
    let productTracking = 'none';
    try {
      // Step 1: get product_tmpl_id and tracking from product.product
      const variants = await odoo.read(
        'product.product',
        [mo.product_id[0]],
        ['product_tmpl_id', 'tracking'],
      );
      if (variants.length > 0) {
        productTracking = variants[0].tracking || 'none';
        if (variants[0].product_tmpl_id) {
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
           'move_raw_ids', 'operation_id', 'operation_note'],
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
        product_tracking: productTracking,
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
          // Before marking done, ensure lot is set if product requires tracking
          const moData = await odoo.read('mrp.production', [moId], [
            'name', 'product_id', 'lot_producing_id', 'company_id',
          ]);
          if (moData.length > 0) {
            const currentMo = moData[0];
            const productId = currentMo.product_id[0];

            // Check product tracking setting
            const prodData = await odoo.read('product.product', [productId], [
              'tracking', 'product_tmpl_id',
            ]);
            const tracking = prodData[0]?.tracking || 'none';

            if (tracking !== 'none' && !currentMo.lot_producing_id) {
              // Auto-create a lot using the MO name as lot name
              const lotName = currentMo.name;
              const companyId = currentMo.company_id?.[0] || false;

              // Check if lot already exists with this name for this product
              const existingLots = await odoo.searchRead('stock.lot',
                [['name', '=', lotName], ['product_id', '=', productId]],
                ['id'],
                { limit: 1 },
              );

              let lotId: number;
              if (existingLots.length > 0) {
                lotId = existingLots[0].id;
              } else {
                // Build lot vals
                const lotVals: Record<string, any> = {
                  name: lotName,
                  product_id: productId,
                };
                if (companyId) lotVals.company_id = companyId;

                // Set expiration date if product uses it
                try {
                  const tmplId = prodData[0]?.product_tmpl_id?.[0];
                  if (tmplId) {
                    const tmplData = await odoo.read('product.template', [tmplId], [
                      'use_expiration_date', 'expiration_time',
                    ]);
                    if (tmplData[0]?.use_expiration_date && tmplData[0]?.expiration_time) {
                      const days = tmplData[0].expiration_time;
                      const expDate = new Date();
                      expDate.setDate(expDate.getDate() + Math.floor(days));
                      // Odoo expects datetime as 'YYYY-MM-DD HH:MM:SS'
                      const pad = (n: number) => String(n).padStart(2, '0');
                      lotVals.expiration_date = `${expDate.getFullYear()}-${pad(expDate.getMonth() + 1)}-${pad(expDate.getDate())} 23:59:59`;
                    }
                  }
                } catch (expErr) {
                  console.warn('Could not set expiration date on lot:', expErr);
                }

                lotId = await odoo.create('stock.lot', lotVals);
              }

              // Set lot_producing_id on the MO
              await odoo.write('mrp.production', [moId], {
                lot_producing_id: lotId,
              });
              console.log(`[MO ${moId}] Auto-created lot ${lotName} (id=${lotId}) for tracked product`);
            }
          }

          // mark_done can return a chain of wizards (consumption warning,
          // then backorder). Handle each in a short loop.
          let action: any = await odoo.buttonCall('mrp.production', 'button_mark_done', [moId]);
          for (let step = 0; step < 4; step++) {
            if (!action || typeof action !== 'object' || !action.res_model) break;
            try {
              const wizModel = action.res_model;
              const ctx = { ...(action.context || {}), active_id: moId, active_ids: [moId] };
              const wizId = await odoo.create(wizModel, {}, { context: ctx });
              const wizIds = Array.isArray(wizId) ? wizId : [wizId];
              if (wizModel === 'mrp.consumption.warning') {
                action = await odoo.call(wizModel, 'action_confirm', [wizIds]);
              } else if (wizModel === 'mrp.production.backorder') {
                // User's intent is "close this MO now". Close without creating
                // a backorder for the remaining qty.
                try {
                  action = await odoo.call(wizModel, 'action_close_mo', [wizIds]);
                } catch {
                  action = await odoo.call(wizModel, 'process', [wizIds]);
                }
              } else if (wizModel === 'mrp.immediate.production') {
                action = await odoo.call(wizModel, 'process', [wizIds]);
              } else {
                action = await odoo.call(wizModel, 'process', [wizIds]);
              }
            } catch (wizErr: any) {
              console.error(`Wizard error at step ${step}:`, wizErr.message);
              break;
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

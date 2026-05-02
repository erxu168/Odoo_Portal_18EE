import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, requireRole, AuthError } from '@/lib/auth';

// Walk the wizard chain Odoo returns from button_mark_done. A wizard's
// confirm method can itself return ANOTHER wizard — e.g. action_close_mo
// re-runs button_mark_done with skip_backorder=True, which can pop a
// fresh consumption warning. Without recursion the chained wizard is
// dropped on the floor and the MO silently stays open. Errors bubble so
// the route handler can surface them.
const MAX_WIZARD_DEPTH = 5;
async function processWizardReturn(
  odoo: ReturnType<typeof getOdoo>,
  moId: number,
  ret: unknown,
  depth = 0,
): Promise<void> {
  if (!ret || typeof ret !== 'object') return;
  const a = ret as { res_model?: string; res_id?: number; context?: Record<string, unknown> };
  if (!a.res_model) return;
  if (depth > MAX_WIZARD_DEPTH) {
    throw new Error(`Could not close MO ${moId}: wizard chain exceeded ${MAX_WIZARD_DEPTH} steps`);
  }

  const wizModel = a.res_model;
  let wizIds: number[];
  if (a.res_id) {
    // Odoo pre-created the wizard (e.g. backorder) — reuse it instead of
    // creating a new blank record that loses default field values.
    wizIds = [a.res_id];
  } else {
    const wizCtx = { ...(a.context || {}), active_id: moId, active_ids: [moId] };
    const wizId = await odoo.create(wizModel, {}, { context: wizCtx });
    wizIds = Array.isArray(wizId) ? wizId : [wizId];
  }

  // Skip flags propagate through any nested button_mark_done call the
  // wizard makes internally — without them, action_confirm can re-pop
  // the same wizard and we hit MAX_WIZARD_DEPTH.
  const skipCtx = { skip_consumption: true, skip_immediate: true, skip_backorder: true };

  let next: unknown;
  if (wizModel === 'mrp.consumption.warning') {
    next = await odoo.call(wizModel, 'action_confirm', [wizIds], { context: skipCtx });
  } else if (wizModel === 'mrp.production.backorder') {
    // action_close_mo finishes the MO without splitting off a backorder.
    // action_backorder would split + close — not what "Close order" means.
    next = await odoo.call(wizModel, 'action_close_mo', [wizIds], { context: skipCtx });
  } else if (wizModel === 'mrp.immediate.production') {
    next = await odoo.call(wizModel, 'process', [wizIds], { context: skipCtx });
  } else {
    throw new Error(`Cannot auto-handle ${wizModel} wizard while closing MO ${moId}. Please close it in Odoo.`);
  }

  await processWizardReturn(odoo, moId, next, depth + 1);
}

// Inventory isn't set up yet — we don't query stock.quant or do FIFO.
// We only satisfy Odoo's "lot required" rule on lot-tracked components
// so button_mark_done doesn't reject the close: every lot-tracked raw
// move gets SOME lot (any existing one, or a freshly created
// placeholder). Stock can go negative; that's accepted until inventory
// is set up. When inventory comes online, swap this for a real FIFO/
// reservation flow.
async function autoAssignComponentLotsForClose(
  odoo: ReturnType<typeof getOdoo>,
  moId: number,
): Promise<void> {
  const mos = await odoo.read('mrp.production', [moId], [
    'move_raw_ids', 'name', 'company_id',
  ]);
  const rawMoveIds: number[] = mos[0]?.move_raw_ids || [];
  if (!rawMoveIds.length) return;
  const moName: string = mos[0]?.name || `MO-${moId}`;
  const companyId: number | false = mos[0]?.company_id?.[0] || false;

  const moves = await odoo.read('stock.move', rawMoveIds, [
    'id', 'product_id', 'product_uom', 'quantity', 'state',
    'move_line_ids', 'location_id', 'location_dest_id', 'name',
  ]);

  for (const move of moves) {
    if (move.state === 'done' || move.state === 'cancel') continue;

    const prod = await odoo.read('product.product', [move.product_id[0]], [
      'tracking', 'display_name',
    ]);
    const tracking = prod[0]?.tracking || 'none';
    if (tracking === 'none') continue;

    const consumedQty: number = move.quantity || 0;
    if (consumedQty <= 0) continue;

    const existingLineIds: number[] = move.move_line_ids || [];
    let qtyAlreadyAssigned = 0;
    const linesWithoutLot: number[] = [];
    if (existingLineIds.length) {
      const lines = await odoo.read('stock.move.line', existingLineIds, [
        'id', 'lot_id', 'quantity',
      ]);
      for (const l of lines) {
        if (l.lot_id) qtyAlreadyAssigned += l.quantity || 0;
        else linesWithoutLot.push(l.id);
      }
    }
    const remaining = consumedQty - qtyAlreadyAssigned;
    if (remaining <= 0.0001) continue;

    if (linesWithoutLot.length) {
      await odoo.unlink('stock.move.line', linesWithoutLot);
    }

    const productId = move.product_id[0];
    let lotId: number;
    const anyLots = await odoo.searchRead(
      'stock.lot',
      [['product_id', '=', productId]],
      ['id'],
      { order: 'create_date desc, id desc', limit: 1 },
    );
    if (anyLots.length) {
      lotId = anyLots[0].id;
    } else {
      const safeName = (prod[0]?.display_name || `product-${productId}`).replace(/\s+/g, '-').slice(0, 40);
      const lotVals: Record<string, any> = {
        name: `${moName}-${safeName}-AUTO`,
        product_id: productId,
      };
      if (companyId) lotVals.company_id = companyId;
      lotId = await odoo.create('stock.lot', lotVals);
    }

    await odoo.create('stock.move.line', {
      move_id: move.id,
      product_id: productId,
      product_uom_id: move.product_uom[0],
      lot_id: lotId,
      location_id: move.location_id[0],
      location_dest_id: move.location_dest_id[0],
      quantity: remaining,
    });
    console.log(`[MO ${moId}] Assigned lot ${lotId} to raw move ${move.id} (${move.name}) for close — inventory not consulted`);
  }
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireAuth();
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

    // Fetch finished product shelf-life settings + tracking
    // These fields live on product.template, so we need to go through the variant
    let shelfLifeChilledDays = 0;
    let shelfLifeFrozenDays = 0;
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
          // Step 2: read shelf-life fields from product.template
          const templates = await odoo.read(
            'product.template',
            [tmplId],
            ['x_shelf_life_chilled_days', 'x_shelf_life_frozen_days'],
          );
          if (templates.length > 0) {
            shelfLifeChilledDays = templates[0]?.x_shelf_life_chilled_days || 0;
            shelfLifeFrozenDays  = templates[0]?.x_shelf_life_frozen_days  || 0;
          }
        }
      }
    } catch (err) {
      // Non-fatal: if fields don't exist, default to 0
      console.warn('Could not fetch product shelf-life fields:', err);
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
        // Shelf-life settings from finished product template
        shelf_life_chilled_days: shelfLifeChilledDays,
        shelf_life_frozen_days:  shelfLifeFrozenDays,
        product_tracking: productTracking,
      },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('GET /api/manufacturing-orders/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch manufacturing order' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireRole('manager');
    const odoo = getOdoo();
    const moId = parseInt(params.id);
    const body = await request.json();

    if (body.action) {
      switch (body.action) {
        case 'confirm':
          await odoo.buttonCall('mrp.production', 'action_confirm', [moId]);
          break;
        case 'mark_done': {
          // Inventory is not set up yet — assign placeholder/any lot to
          // every lot-tracked component so Odoo doesn't reject the close
          // with a "supply Lot/Serial" error. No stock.quant, no FIFO.
          await autoAssignComponentLotsForClose(odoo, moId);

          const moData = await odoo.read('mrp.production', [moId], [
            'name', 'product_id', 'lot_producing_id', 'company_id',
            'qty_producing', 'product_qty',
          ]);
          if (moData.length === 0) {
            return NextResponse.json({ error: 'MO not found' }, { status: 404 });
          }
          const currentMo = moData[0];
          const productId = currentMo.product_id[0];

          // Default qty_producing to product_qty when zero. Odoo 18's
          // button_mark_done expects a non-zero value; without this the
          // close either no-ops or pops a wizard and the user is stuck.
          if (!currentMo.qty_producing || currentMo.qty_producing <= 0) {
            await odoo.write('mrp.production', [moId], {
              qty_producing: currentMo.product_qty,
            });
          }

          // Auto-create a lot for tracked products when none assigned.
          const prodData = await odoo.read('product.product', [productId], [
            'tracking', 'product_tmpl_id',
          ]);
          const tracking = prodData[0]?.tracking || 'none';

          if (tracking !== 'none' && !currentMo.lot_producing_id) {
            const lotName = currentMo.name;
            const companyId = currentMo.company_id?.[0] || false;

            const existingLots = await odoo.searchRead('stock.lot',
              [['name', '=', lotName], ['product_id', '=', productId]],
              ['id'],
              { limit: 1 },
            );

            let lotId: number;
            if (existingLots.length > 0) {
              lotId = existingLots[0].id;
            } else {
              const lotVals: Record<string, any> = {
                name: lotName,
                product_id: productId,
              };
              if (companyId) lotVals.company_id = companyId;

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
                    const pad = (n: number) => String(n).padStart(2, '0');
                    lotVals.expiration_date = `${expDate.getFullYear()}-${pad(expDate.getMonth() + 1)}-${pad(expDate.getDate())} 23:59:59`;
                  }
                }
              } catch (expErr) {
                console.warn('Could not set expiration date on lot:', expErr);
              }

              lotId = await odoo.create('stock.lot', lotVals);
            }

            await odoo.write('mrp.production', [moId], { lot_producing_id: lotId });
            console.log(`[MO ${moId}] Auto-created lot ${lotName} (id=${lotId}) for tracked product`);
          }

          // Skip flags tell Odoo to bypass the consumption-warning,
          // immediate-production, and backorder wizards entirely (since
          // we want to close regardless of inventory mismatches). The
          // wizard handler stays as a safety net for any wizard Odoo
          // still decides to return.
          const result = await odoo.call(
            'mrp.production',
            'button_mark_done',
            [[moId]],
            { context: { skip_consumption: true, skip_immediate: true, skip_backorder: true } },
          );
          await processWizardReturn(odoo, moId, result);

          // Final state check: if the MO didn't actually transition to a
          // closed state, surface that to the UI instead of pretending it
          // closed. Without this the user sees a green "done" but the MO
          // stays in to_close / progress and they hit the same dead end
          // next time.
          const after = await odoo.read('mrp.production', [moId], ['state', 'name']);
          const finalState = after[0]?.state;
          if (finalState !== 'done' && finalState !== 'cancel') {
            return NextResponse.json(
              {
                error: `Could not close ${after[0]?.name || 'manufacturing order'}: it is still in state "${finalState}". Open it in Odoo to see what's blocking — most likely an incomplete work order or a finished-product lot/serial issue.`,
              },
              { status: 409 },
            );
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
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('PATCH /api/manufacturing-orders/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to update manufacturing order' },
      { status: 500 },
    );
  }
}

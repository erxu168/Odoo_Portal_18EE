import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/manufacturing-orders/[id]
 * Full MO detail with components and work orders
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const odoo = getOdoo();
    const moId = parseInt(params.id);

    const mos = await odoo.read('mrp.production', [moId], [
      'name',
      'product_id',
      'product_qty',
      'product_uom_id',
      'bom_id',
      'state',
      'date_start',
      'date_finished',
      'date_deadline',
      'user_id',
      'qty_producing',
      'workorder_ids',
      'move_raw_ids',
    ]);

    if (!mos.length) {
      return NextResponse.json({ error: 'MO not found' }, { status: 404 });
    }

    const mo = mos[0];

    // ── Fetch components (stock.move lines) ──
    // BUG FIX: Read is_done and state to determine actual consumed qty.
    // In Odoo 18 EE, stock.move.quantity = demand/reserved when state != 'done',
    // and = actual consumed when state = 'done'.
    const components = mo.move_raw_ids?.length
      ? await odoo.searchRead(
          'stock.move',
          [['id', 'in', mo.move_raw_ids]],
          [
            'product_id',
            'product_uom_qty',
            'quantity',
            'product_uom',
            'forecast_availability',
            'state',
            'is_done',
            'should_consume_qty',
          ],
        )
      : [];

    // Enrich components with proper consumed_qty
    const enrichedComponents = components.map((c: any) => {
      // consumed_qty: only show as consumed when move is actually done
      const consumed = c.is_done || c.state === 'done'
        ? c.quantity
        : (c.should_consume_qty > 0 ? c.should_consume_qty : 0);

      return {
        ...c,
        consumed_qty: consumed,
      };
    });

    // ── Fetch work orders ──
    const workOrders = mo.workorder_ids?.length
      ? await odoo.searchRead(
          'mrp.workorder',
          [['id', 'in', mo.workorder_ids]],
          [
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
          ],
          { order: 'sequence asc' },
        )
      : [];

    // Calculate progress
    const doneWos = workOrders.filter((wo: any) => wo.state === 'done').length;
    const totalWos = workOrders.length;
    const progressPercent = totalWos > 0 ? Math.round((doneWos / totalWos) * 100) : 0;

    return NextResponse.json({
      order: {
        ...mo,
        components: enrichedComponents,
        work_orders: workOrders,
        progress_percent: progressPercent,
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

/**
 * PATCH /api/manufacturing-orders/[id]
 * Update MO or trigger actions (confirm, mark_done, cancel)
 */
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
        case 'mark_done':
          await odoo.buttonCall('mrp.production', 'button_mark_done', [moId]);
          break;
        case 'cancel':
          await odoo.buttonCall('mrp.production', 'action_cancel', [moId]);
          break;
        default:
          return NextResponse.json(
            { error: `Unknown action: ${body.action}` },
            { status: 400 },
          );
      }
    } else if (body.vals) {
      await odoo.write('mrp.production', [moId], body.vals);
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

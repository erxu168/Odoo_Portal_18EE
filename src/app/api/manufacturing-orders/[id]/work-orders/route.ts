import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

/**
 * GET /api/manufacturing-orders/[id]/work-orders
 * List work orders for an MO with their assigned components
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireAuth();
    const odoo = getOdoo();
    const moId = parseInt(params.id);

    const workOrders = await odoo.searchRead(
      'mrp.workorder',
      [['production_id', '=', moId]],
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
    );

    // Enrich each work order with its component details
    const enriched = await Promise.all(
      workOrders.map(async (wo: any) => {
        let components: any[] = [];
        if (wo.move_raw_ids?.length) {
          components = await odoo.searchRead(
            'stock.move',
            [['id', 'in', wo.move_raw_ids]],
            [
              'product_id',
              'product_uom_qty',
              'quantity',
              'product_uom',
              'forecast_availability',
              'state',
            ],
          );
        }
        return { ...wo, components };
      }),
    );

    return NextResponse.json({ work_orders: enriched });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('GET /api/manufacturing-orders/[id]/work-orders error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch work orders' },
      { status: 500 },
    );
  }
}

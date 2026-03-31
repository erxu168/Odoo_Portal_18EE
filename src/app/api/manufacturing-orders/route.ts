import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import type { CreateMoRequest } from '@/types/manufacturing';

/**
 * GET /api/manufacturing-orders
 * List manufacturing orders with optional filters.
 * Supports ?company_id=X to filter by company.
 */
export async function GET(request: Request) {
  try {
    const odoo = getOdoo();
    const { searchParams } = new URL(request.url);
    const state = searchParams.get('state');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50');
    const companyId = searchParams.get('company_id');

    const domain: any[] = [];
    if (state && state !== 'all') {
      if (state === 'active') {
        domain.push(['state', 'in', ['confirmed', 'progress']]);
      } else {
        domain.push(['state', '=', state]);
      }
    }
    if (search) {
      domain.push('|');
      domain.push(['name', 'ilike', search]);
      domain.push(['product_id.name', 'ilike', search]);
    }
    if (companyId) {
      domain.push(['company_id', '=', parseInt(companyId)]);
    }

    const orders = await odoo.searchRead('mrp.production', domain, [
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
      'company_id',
      'create_date',
    ], { limit, order: 'id desc' });

    // Fetch work order states for all MOs in one batch
    const allWoIds = orders.flatMap((mo: any) => mo.workorder_ids || []);
    const woStates: Record<number, string> = {};
    if (allWoIds.length > 0) {
      const wos = await odoo.read('mrp.workorder', allWoIds, ['id', 'state']);
      for (const wo of wos) {
        woStates[wo.id] = wo.state;
      }
    }

    const enriched = orders.map((mo: any) => {
      const woIds = mo.workorder_ids || [];
      const woCount = woIds.length;
      const woDone = woIds.filter((id: number) => woStates[id] === 'done').length;
      return {
        ...mo,
        work_order_count: woCount,
        work_order_done: woDone,
      };
    });

    return NextResponse.json({ orders: enriched, total: enriched.length });
  } catch (error: any) {
    console.error('GET /api/manufacturing-orders error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch manufacturing orders' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/manufacturing-orders
 * Create a new manufacturing order
 */
export async function POST(request: Request) {
  try {
    const odoo = getOdoo();
    const body: CreateMoRequest = await request.json();

    const vals: Record<string, any> = {
      product_id: body.product_id,
      bom_id: body.bom_id,
      product_qty: body.product_qty,
      product_uom_id: body.product_uom_id,
    };

    if (body.date_deadline) vals.date_deadline = body.date_deadline;
    if (body.user_id) vals.user_id = body.user_id;
    if (body.company_id) {
      vals.company_id = body.company_id;
    }

    const moId = await odoo.create('mrp.production', vals, {
      context: {
        lang: 'de_DE',
        tz: 'Europe/Berlin',
        ...(body.company_id
          ? {
              allowed_company_ids: [body.company_id],
              company_id: body.company_id,
            }
          : {}),
      },
    });

    const created = await odoo.read('mrp.production', [moId], [
      'name',
      'product_id',
      'product_qty',
      'product_uom_id',
      'state',
      'workorder_ids',
      'move_raw_ids',
    ]);

    return NextResponse.json({ order: created[0], id: moId }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/manufacturing-orders error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create manufacturing order' },
      { status: 500 },
    );
  }
}

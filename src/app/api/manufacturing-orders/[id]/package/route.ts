/**
 * POST /api/manufacturing-orders/[id]/package
 * 
 * Container split + partial production flow (Option A):
 * 1. Creates container split record in SQLite
 * 2. For each container, calls Odoo partial produce:
 *    - Creates stock.lot with expiry date
 *    - Sets qty_producing on the MO
 *    - Calls produce_or_create_backorder (partial) or button_mark_done (final)
 * 3. Each container gets its own lot in Odoo with correct qty + expiry
 *
 * GET /api/manufacturing-orders/[id]/package
 * Returns existing split + containers for this MO.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/db';
import { cookies } from 'next/headers';
import { odooRPC } from '@/lib/odoo';
import {
  createSplit, confirmSplit, getSplitByMo, getContainers, updateContainerLot,
} from '@/lib/labeling-db';
import type { CreateSplitRequest } from '@/types/labeling';

interface RouteParams { params: Promise<{ id: string }> }

// --- GET: fetch existing split ---
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const moId = parseInt(id, 10);
  if (isNaN(moId)) return NextResponse.json({ error: 'Invalid MO ID' }, { status: 400 });

  const cookieStore = await cookies();
  const token = cookieStore.get('kw_session')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const split = getSplitByMo(moId);
  if (!split) return NextResponse.json({ split: null, containers: [] });
  const containers = getContainers(split.id);
  return NextResponse.json({ split, containers });
}

// Allowed MO states for packaging
const ALLOWED_STATES = ['confirmed', 'progress', 'to_close'];

// --- POST: create split + partial produce ---
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const moId = parseInt(id, 10);
  if (isNaN(moId)) return NextResponse.json({ error: 'Invalid MO ID' }, { status: 400 });

  const cookieStore = await cookies();
  const token = cookieStore.get('kw_session')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as CreateSplitRequest;

  // Validate totals
  const sumQty = body.containers.reduce((s, c) => s + c.qty, 0);
  const tolerance = Math.max(0.005, body.total_qty * 0.001);
  if (Math.abs(sumQty - body.total_qty) > tolerance) {
    return NextResponse.json(
      { error: `Container total (${sumQty}) does not match MO qty (${body.total_qty})` },
      { status: 400 }
    );
  }
  if (body.containers.length === 0) {
    return NextResponse.json({ error: 'At least one container required' }, { status: 400 });
  }

  // Check MO state
  const [mo] = await odooRPC('mrp.production', 'read', [[moId], ['state', 'product_id', 'product_qty', 'product_uom_id']]) as any[];
  if (!mo) return NextResponse.json({ error: 'MO not found in Odoo' }, { status: 404 });
  if (!ALLOWED_STATES.includes(mo.state)) {
    return NextResponse.json({ error: `MO is in state "${mo.state}", must be confirmed, in progress, or to close` }, { status: 400 });
  }

  // Check product has lot tracking
  const [product] = await odooRPC('product.product', 'read', [[mo.product_id[0]], ['tracking']]) as any[];
  if (!product || product.tracking === 'none') {
    return NextResponse.json(
      { error: 'Product must have lot tracking enabled. Enable it in Odoo: Product > Inventory tab > Tracking = By Lots.' },
      { status: 400 }
    );
  }

  // Create split record in SQLite
  const { splitId, containerIds } = createSplit(body, user.id);

  // Track current MO ID (changes with backorders)
  let currentMoId = moId;

  // Partial produce for each container
  const errors: string[] = [];
  for (let i = 0; i < body.containers.length; i++) {
    const c = body.containers[i];
    const containerId = containerIds[i];
    const isLast = i === body.containers.length - 1;

    try {
      // 1. Generate lot name
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const lotName = `${body.mo_name}-${dateStr}-${String(i + 1).padStart(2, '0')}`;

      // 2. Create stock.lot in Odoo
      const lotVals: Record<string, unknown> = {
        name: lotName,
        product_id: mo.product_id[0],
        company_id: (await odooRPC('mrp.production', 'read', [[currentMoId], ['company_id']]) as any[])[0]?.company_id?.[0] ?? 2,
      };
      if (c.expiry_date) {
        lotVals.expiration_date = c.expiry_date.includes('T')
          ? c.expiry_date
          : c.expiry_date + ' 00:00:00';
      }
      const lotId = await odooRPC('stock.lot', 'create', [[lotVals]]) as number;

      // 3. Set qty_producing + lot on MO
      await odooRPC('mrp.production', 'write', [[currentMoId], {
        qty_producing: c.qty,
        lot_producing_id: lotId,
      }]);

      // 4. Produce
      if (isLast) {
        await odooRPC('mrp.production', 'button_mark_done', [[currentMoId]]);
      } else {
        const result = await odooRPC('mrp.production', 'button_mark_done', [[currentMoId]]);
        // Handle backorder wizard
        if (result && typeof result === 'object' && 'res_model' in (result as any)) {
          const wizardModel = (result as any).res_model;
          const wizardId = (result as any).res_id;
          if (wizardModel === 'mrp.production.backorder') {
            await odooRPC(wizardModel, 'action_backorder', [[wizardId]]);
            // Find the backorder MO for next iteration
            const backorders = await odooRPC('mrp.production', 'search_read', [
              [['backorder_id', '=', currentMoId], ['state', 'in', ALLOWED_STATES]],
              ['id', 'name'],
            ]) as any[];
            if (backorders.length > 0) {
              currentMoId = backorders[0].id;
            }
          }
        }
      }

      // 5. Update container with lot info
      updateContainerLot(containerId, lotName, lotId as number);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Container ${i + 1}: ${msg}`);
    }
  }

  if (errors.length === 0) {
    confirmSplit(splitId);
  }

  const containers = getContainers(splitId);
  const split = getSplitByMo(body.mo_id);

  return NextResponse.json({
    split,
    containers,
    errors: errors.length > 0 ? errors : undefined,
  }, { status: errors.length > 0 ? 207 : 200 });
}

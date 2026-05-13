import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

const EDITABLE_STATES = ['draft', 'confirmed', 'progress'];

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireAuth();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const moId = Number(params.id);
  if (!Number.isInteger(moId)) {
    return NextResponse.json({ error: 'Invalid MO id' }, { status: 400 });
  }

  let body: { product_id?: number; qty?: number; uom_id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const productId = Number(body.product_id);
  const qty = Number(body.qty);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'qty must be a positive number' }, { status: 400 });
  }

  const odoo = getOdoo();

  const mos = await odoo.read('mrp.production', [moId], [
    'id', 'name', 'state', 'location_src_id', 'production_location_id', 'company_id',
  ]);
  if (!mos.length) {
    return NextResponse.json({ error: 'MO not found' }, { status: 404 });
  }
  const mo = mos[0];
  if (!EDITABLE_STATES.includes(mo.state)) {
    return NextResponse.json(
      { error: `MO state '${mo.state}' is not editable.` },
      { status: 409 },
    );
  }

  let uomId = Number(body.uom_id) || 0;
  if (!uomId) {
    const prods = await odoo.read('product.product', [productId], ['uom_id', 'display_name']);
    if (!prods.length) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    uomId = prods[0].uom_id?.[0];
  }
  if (!uomId) {
    return NextResponse.json({ error: 'Could not resolve unit of measure.' }, { status: 422 });
  }

  const prods2 = await odoo.read('product.product', [productId], ['display_name']);
  const productName = prods2[0]?.display_name || `Product ${productId}`;

  const moveId = await odoo.create('stock.move', {
    name: productName,
    product_id: productId,
    product_uom_qty: qty,
    product_uom: uomId,
    raw_material_production_id: moId,
    location_id: mo.location_src_id?.[0],
    location_dest_id: mo.production_location_id?.[0],
    company_id: mo.company_id?.[0],
  });

  if (['confirmed', 'progress'].includes(mo.state)) {
    await odoo.call('stock.move', '_action_confirm', [[moveId]]);
  }

  return NextResponse.json({
    move_id: moveId,
    product_id: productId,
    product_name: productName,
    planned_qty: qty,
    uom_id: uomId,
  });
}

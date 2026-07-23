export const dynamic = 'force-dynamic';
/**
 * Suppliers for a product — Odoo product.supplierinfo (the "Purchase" vendor
 * list). Manager+ (product settings). All rows hang off the product's TEMPLATE.
 *
 * GET    — list this product's suppliers (vendor, price, min qty, lead time)
 * POST   — add a supplier { vendor_id, price?, min_qty?, delay? }
 * PUT    — edit one   { supplierinfo_id, price?, min_qty?, delay? }
 * DELETE — remove one ?supplierinfo_id=
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo, type OdooClient } from '@/lib/odoo';

function authed() {
  const user = requireAuth();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return { error: NextResponse.json({ error: 'Manager access required' }, { status: 403 }) };
  }
  return { user };
}

function pid(params: { id: string }) {
  const n = parseInt(params.id, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The product's TEMPLATE id — supplierinfo rows attach to the template. */
async function templateOf(odoo: OdooClient, productId: number): Promise<number | null> {
  const rows = await odoo.searchRead('product.product', [['id', '=', productId]], ['product_tmpl_id'],
    { limit: 1, context: { active_test: false } });
  const t = (rows[0] as { product_tmpl_id?: [number, string] | number })?.product_tmpl_id;
  return Array.isArray(t) ? t[0] : (typeof t === 'number' ? t : null);
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const a = authed(); if (a.error) return a.error;
  const productId = pid(params); if (!productId) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  try {
    const odoo = getOdoo();
    const tmplId = await templateOf(odoo, productId);
    if (!tmplId) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const rows = await odoo.searchRead('product.supplierinfo', [['product_tmpl_id', '=', tmplId]],
      ['id', 'partner_id', 'price', 'min_qty', 'delay', 'product_code'],
      { order: 'sequence, min_qty, price' });
    return NextResponse.json({ suppliers: rows });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const a = authed(); if (a.error) return a.error;
  const productId = pid(params); if (!productId) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  const body = await request.json();
  const vendorId = Number(body.vendor_id);
  if (!Number.isInteger(vendorId) || vendorId <= 0) return NextResponse.json({ error: 'Pick a supplier' }, { status: 400 });
  const price = body.price != null && body.price !== '' ? Number(body.price) : 0;
  if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Price must be 0 or more' }, { status: 400 });
  const minQty = body.min_qty != null && body.min_qty !== '' ? Number(body.min_qty) : 0;
  if (!Number.isFinite(minQty) || minQty < 0) return NextResponse.json({ error: 'Min qty must be 0 or more' }, { status: 400 });
  try {
    const odoo = getOdoo();
    const vendor = await odoo.searchRead('res.partner', [['id', '=', vendorId], ['supplier_rank', '>', 0]], ['id'], { limit: 1 });
    if (vendor.length === 0) return NextResponse.json({ error: 'That vendor is not a supplier' }, { status: 400 });
    const tmplId = await templateOf(odoo, productId);
    if (!tmplId) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const id = await odoo.create('product.supplierinfo', { partner_id: vendorId, product_tmpl_id: tmplId, price, min_qty: minQty });
    return NextResponse.json({ id });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const a = authed(); if (a.error) return a.error;
  const productId = pid(params); if (!productId) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  const body = await request.json();
  const supId = Number(body.supplierinfo_id);
  if (!Number.isInteger(supId) || supId <= 0) return NextResponse.json({ error: 'Missing supplier row' }, { status: 400 });
  const vals: Record<string, unknown> = {};
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Price must be 0 or more' }, { status: 400 });
    vals.price = price;
  }
  if (body.min_qty !== undefined) {
    const minQty = Number(body.min_qty);
    if (!Number.isFinite(minQty) || minQty < 0) return NextResponse.json({ error: 'Min qty must be 0 or more' }, { status: 400 });
    vals.min_qty = minQty;
  }
  if (Object.keys(vals).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  try {
    const odoo = getOdoo();
    // Scope check: the row must belong to THIS product's template.
    const tmplId = await templateOf(odoo, productId);
    const row = await odoo.searchRead('product.supplierinfo', [['id', '=', supId], ['product_tmpl_id', '=', tmplId]], ['id'], { limit: 1 });
    if (row.length === 0) return NextResponse.json({ error: 'Supplier row not found for this product' }, { status: 404 });
    await odoo.write('product.supplierinfo', [supId], vals);
    return NextResponse.json({ message: 'Supplier updated' });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const a = authed(); if (a.error) return a.error;
  const productId = pid(params); if (!productId) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  const supId = parseInt(new URL(request.url).searchParams.get('supplierinfo_id') || '0', 10);
  if (!supId) return NextResponse.json({ error: 'Missing supplier row' }, { status: 400 });
  try {
    const odoo = getOdoo();
    const tmplId = await templateOf(odoo, productId);
    const row = await odoo.searchRead('product.supplierinfo', [['id', '=', supId], ['product_tmpl_id', '=', tmplId]], ['id'], { limit: 1 });
    if (row.length === 0) return NextResponse.json({ error: 'Supplier row not found for this product' }, { status: 404 });
    await odoo.unlink('product.supplierinfo', [supId]);
    return NextResponse.json({ message: 'Supplier removed' });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}

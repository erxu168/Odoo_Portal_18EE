export const dynamic = 'force-dynamic';
/**
 * /api/inventory/receipts — goods received ("purchased-in"), portal-owned, no Odoo.
 *
 * GET    — list receipts (scoped to the active/allowed company; optional product_id, from, to)
 * POST   — log a receipt (base quantity computed server-side, like counts)
 * DELETE — remove a receipt (?id=), bounded to the caller's companies
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { initInventoryTables, createReceipt, listReceipts, deleteReceipt } from '@/lib/inventory-db';
import { isUnrestrictedAdmin, canAccessCompany } from '@/lib/inventory-access';
import { crateTotal } from '@/lib/crate-units';

function activeCompany(searchParams: URLSearchParams): number {
  return parseInt(searchParams.get('company_id') || '0', 10)
    || parseInt(cookies().get('kw_company_id')?.value || '0', 10);
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const allowed = parseCompanyIds(user.allowed_company_ids);
  const admin = isUnrestrictedAdmin(user);
  const active = activeCompany(searchParams);
  // Source of truth: the active company when accessible, else the allowed set.
  // An unrestricted admin with no active pick sees all (company_ids undefined).
  let company_ids: number[] | undefined;
  if (active && (admin || canAccessCompany(user, active))) company_ids = [active];
  else if (!admin) company_ids = allowed;

  const productId = searchParams.get('product_id');
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  const receipts = listReceipts({
    ...(company_ids !== undefined ? { company_ids } : {}),
    product_id: productId ? parseInt(productId) : undefined,
    from, to,
  });
  return NextResponse.json({ receipts });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const body = await request.json();
  const { product_id, count_location_id, crate_qty, loose_qty, units_per_crate, counted_qty, uom, note, photo } = body;
  const { searchParams } = new URL(request.url);
  const company = body.company_id != null ? Number(body.company_id) : activeCompany(searchParams);
  if (!company || !(isUnrestrictedAdmin(user) || canAccessCompany(user, company))) {
    return NextResponse.json({ error: 'Pick a restaurant you can access' }, { status: 400 });
  }
  if (!product_id) return NextResponse.json({ error: 'product_id required' }, { status: 400 });

  // Base total computed HERE (server is source of truth). A pack split converts;
  // otherwise the plain quantity is used. Must be a sane positive number.
  const hasSplit = units_per_crate != null && Number(units_per_crate) > 0 && (crate_qty !== undefined || loose_qty !== undefined);
  const qtyBase = hasSplit
    ? crateTotal(Number(crate_qty) || 0, Number(loose_qty) || 0, Number(units_per_crate))
    : Number(counted_qty);
  if (!Number.isFinite(qtyBase) || qtyBase <= 0 || qtyBase > 1e7) {
    return NextResponse.json({ error: 'Enter a valid quantity' }, { status: 400 });
  }
  const locId = Number.isInteger(count_location_id) && count_location_id >= 0 ? count_location_id : 0;

  const id = createReceipt({
    company_id: company,
    odoo_product_id: Number(product_id),
    count_location_id: locId,
    qty_base: qtyBase,
    crate_qty: hasSplit ? (Number(crate_qty) || 0) : null,
    loose_qty: hasSplit ? (Number(loose_qty) || 0) : null,
    units_per_crate: hasSplit ? Number(units_per_crate) : null,
    uom: uom || 'Units',
    note: note ? String(note).slice(0, 500) : null,
    photo: typeof photo === 'string' ? photo : null,
    received_by: user.id,
  });
  return NextResponse.json({ id, message: 'Receipt logged' }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const bound = isUnrestrictedAdmin(user) ? null : parseCompanyIds(user.allowed_company_ids);
  const changed = deleteReceipt(parseInt(id), bound);
  if (changed === 0) return NextResponse.json({ error: 'Not found or not yours' }, { status: 404 });
  return NextResponse.json({ message: 'Receipt removed' });
}

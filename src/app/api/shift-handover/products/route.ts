export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { listHandoverProducts, createHandoverProduct, updateHandoverProduct, getHandoverProduct, productHasBatches, deleteHandoverProduct } from '@/lib/shift-handover/db';
import { PHOTO_POLICIES } from '@/lib/shift-handover/states';

export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const includeInactive = new URL(request.url).searchParams.get('all') === '1';
  return NextResponse.json({ products: listHandoverProducts(companyId, { includeInactive }) });
}

export async function POST(request: Request) {
  const authz = authorize(CAP.configure);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  if (!body?.name?.trim()) return jsonError(400, 'A product name is required.');
  const policy = PHOTO_POLICIES.includes(body.photo_policy) ? body.photo_policy : 'optional';
  const id = createHandoverProduct({ company_id: companyId, name: body.name.trim(), kind: body.kind || 'finished', unit: body.unit ?? null, photo_policy: policy });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const authz = authorize(CAP.configure);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  const id = parseInt(String(body?.id), 10);
  const product = getHandoverProduct(id);
  if (!id || !product || product.company_id !== companyId) return jsonError(404, 'Product not found.');
  updateHandoverProduct(id, companyId, {
    name: body.name, kind: body.kind, unit: body.unit,
    photo_policy: PHOTO_POLICIES.includes(body.photo_policy) ? body.photo_policy : undefined,
    active: body.active,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const authz = authorize(CAP.configure, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  const product = getHandoverProduct(id);
  if (!id || !product || product.company_id !== companyId) return jsonError(404, 'Product not found.');
  // Never orphan production history — a used product is renamed, not deleted.
  if (productHasBatches(id)) return jsonError(409, 'This product has recorded production. Rename it instead of deleting.');
  deleteHandoverProduct(id, companyId);
  return NextResponse.json({ ok: true });
}

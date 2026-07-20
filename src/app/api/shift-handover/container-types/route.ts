export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { listContainerTypes, createContainerType, updateContainerType, getContainerType, containerTypeInUse, deleteContainerTypeRow } from '@/lib/shift-handover/db';

export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const includeInactive = new URL(request.url).searchParams.get('all') === '1';
  return NextResponse.json({ container_types: listContainerTypes(companyId, { includeInactive }) });
}

export async function POST(request: Request) {
  const authz = authorize(CAP.configure);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  if (!body?.name?.trim()) return jsonError(400, 'A container name is required.');
  const id = createContainerType({ company_id: companyId, name: body.name.trim(), category: body.category ?? null, capacity_label: body.capacity_label ?? null, reference_photo: body.reference_photo ?? null, internal_code: body.internal_code ?? null });
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
  const ct = getContainerType(id);
  if (!id || !ct || ct.company_id !== companyId) return jsonError(404, 'Container type not found.');
  updateContainerType(id, companyId, { name: body.name, category: body.category, capacity_label: body.capacity_label, reference_photo: body.reference_photo, internal_code: body.internal_code, active: body.active });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const authz = authorize(CAP.configure, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  const ct = getContainerType(id);
  if (!id || !ct || ct.company_id !== companyId) return jsonError(404, 'Container type not found.');
  if (containerTypeInUse(id)) return jsonError(409, 'This container type is in use. Rename it instead of deleting.');
  deleteContainerTypeRow(id, companyId);
  return NextResponse.json({ ok: true });
}

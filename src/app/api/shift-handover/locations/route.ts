export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getLocations } from '@/lib/shift-handover/queries';
import { createCountLocation, getCountLocation } from '@/lib/inventory-db';

// Storage locations REUSE the shared count_locations tree.
export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  return NextResponse.json(getLocations(companyId));
}

export async function POST(request: Request) {
  const authz = authorize(CAP.configure);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  if (!body?.name?.trim()) return jsonError(400, 'A location name is required.');
  let parentId: number | null = null;
  if (body.parent_id != null) {
    const parent = getCountLocation(parseInt(String(body.parent_id), 10));
    if (!parent || parent.company_id !== companyId) return jsonError(400, 'Invalid parent location.');
    parentId = parent.id;
  }
  const id = createCountLocation({ company_id: companyId, parent_id: parentId, name: body.name.trim(), kind: body.kind || 'area', created_by: authz.actor.userId });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

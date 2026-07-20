export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getLocations } from '@/lib/shift-handover/queries';
import { createCountLocation, getCountLocation, updateCountLocation } from '@/lib/inventory-db';
import { locationDescendantIds, locationInUse } from '@/lib/shift-handover/db';

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

// PATCH — rename / re-kind / (de)activate a storage location.
export async function PATCH(request: Request) {
  const authz = authorize(CAP.configure, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  const id = parseInt(String(body?.id), 10);
  const loc = getCountLocation(id);
  if (!id || !loc || loc.company_id !== companyId) return jsonError(404, 'Location not found.');
  if (body.name !== undefined && !String(body.name).trim()) return jsonError(400, 'A location name is required.');
  updateCountLocation(id, companyId, {
    name: body.name !== undefined ? String(body.name).trim() : undefined,
    kind: body.kind, active: body.active,
  });
  return NextResponse.json({ ok: true });
}

// DELETE — remove a location (and its sub-locations). Storage locations are the
// SHARED count_locations tree (inventory history references them), so we SOFT-remove
// (active = 0) the whole subtree rather than hard-delete and orphan inventory rows
// like count_entries / session_location_status. Blocked if it (or a sub-location)
// still holds a handover container, so we never orphan a container's place.
export async function DELETE(request: Request) {
  const authz = authorize(CAP.configure, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  const loc = getCountLocation(id);
  if (!id || !loc || loc.company_id !== companyId) return jsonError(404, 'Location not found.');
  const ids = locationDescendantIds(id, companyId);
  if (locationInUse(ids)) return jsonError(409, 'This location (or a sub-location) still holds a container. Move those first, or rename it instead.');
  for (const lid of ids) updateCountLocation(lid, companyId, { active: false }); // soft-remove subtree
  return NextResponse.json({ ok: true });
}

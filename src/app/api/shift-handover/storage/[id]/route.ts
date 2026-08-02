export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { roleCan, type Role } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { listCountLocations, initInventoryTables } from '@/lib/inventory-db';
import { locationPathLabel } from '@/lib/location-tree';
import { berlinToday, isCanonicalDay } from '@/lib/berlin-date';
import {
  getStorageItem, getStorageItemView, updateStorageItem, softDeleteStorageItem,
  listLookups, getLookup, listPhotos, parseAmount,
} from '@/lib/shift-handover/db';

// GET — one storage item's full detail (for the tap-to-open sheet).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const item = getStorageItemView(parseInt(params.id, 10), companyId);
  if (!item) return jsonError(404, 'Item not found.');
  const canPost = roleCan(authz.actor.role as Role, CAP.post, getPermissionOverrides());
  const photos = item.entry_id ? listPhotos('log_entry', item.entry_id).map((p) => p.photo) : [];
  return NextResponse.json({ item: { ...item, photos, can_edit: canPost, can_delete: canPost } });
}

// PATCH — edit a storage item (name / amount / unit / place / use-first / prepared-on).
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const item = getStorageItem(parseInt(params.id, 10));
  if (!item || item.company_id !== companyId || item.status !== 'here') return jsonError(404, 'Item not found.');

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  // Item + name go together. The row's EFFECTIVE catalogue link (the new id if
  // supplied, else the one it already has) decides the name: a linked row always
  // takes the catalogue name; only an "Other" (null) row uses a typed name.
  let effItemId: number | null | undefined; // undefined = item_id not being changed
  if (body?.item_id !== undefined) {
    if (body.item_id == null) {
      effItemId = null;
    } else {
      const lk = getLookup(Number(body.item_id));
      if (!lk || lk.company_id !== companyId || lk.kind !== 'prepped_item' || !lk.active) return jsonError(400, 'Pick an item from the list.');
      effItemId = lk.id;
    }
    patch.item_id = effItemId;
  }
  const linkedId = effItemId !== undefined ? effItemId : item.item_id;
  if (linkedId != null) {
    const lk = getLookup(linkedId);
    if (lk) patch.name = lk.name; // catalogue name is authoritative for a linked row
  } else if (typeof body?.name === 'string') {
    const name = body.name.trim();
    if (!name) return jsonError(400, 'What is it?');
    patch.name = name;
  }
  if (body?.amount !== undefined) {
    const amt = parseAmount(body.amount);
    if (!Number.isFinite(amt) || amt <= 0) return jsonError(400, 'How much is it?');
    patch.amount = amt;
  }
  if (typeof body?.unit === 'string') {
    const unit = body.unit.trim();
    if (!unit || !listLookups(companyId, 'unit').some((u) => u.name === unit)) return jsonError(400, 'Pick a unit.');
    patch.unit = unit;
  }
  if (body?.use_first !== undefined) patch.use_first = !!body.use_first;
  if (body?.prepared_on !== undefined) {
    const d = typeof body.prepared_on === 'string' ? body.prepared_on.trim() : '';
    if (!isCanonicalDay(d) || d > berlinToday()) return jsonError(400, 'That prepared-on date isn’t valid.');
    patch.prepared_on = d;
  }
  if (body?.location_id !== undefined) {
    const id = Number.isInteger(body.location_id) ? Number(body.location_id) : NaN;
    if (!Number.isInteger(id) || id <= 0) return jsonError(400, 'Choose where you put it.');
    initInventoryTables();
    const locs = listCountLocations(companyId);
    if (!locs.some((l) => l.id === id)) return jsonError(400, 'That place is not one of this restaurant’s.');
    patch.location_id = id;
    patch.location_text = locationPathLabel(id, locs);
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });
  updateStorageItem(item.id, companyId, patch);
  const after = getStorageItemView(item.id, companyId);
  return NextResponse.json({ ok: true, item: after });
}

// DELETE — remove an item outright (a mistake, not "used up"). Any staff on shift.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const item = getStorageItem(parseInt(params.id, 10));
  if (!item || item.company_id !== companyId) return jsonError(404, 'Item not found.');
  softDeleteStorageItem(item.id, companyId);
  return NextResponse.json({ ok: true });
}

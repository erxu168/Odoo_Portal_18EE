export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, operationalDate, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { roleCan, type Role } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { berlinToday } from '@/lib/berlin-date';
import {
  ensureDefaultLogTypes, ensureDefaultLookups, listLogTypes, listLookups, listLogEntries,
  listPhotosForEntities, listStorageHere, recentEntryDates,
} from '@/lib/shift-handover/db';

// GET — everything the shift-log screen needs for a given day, in one call:
// the manager-configured types + lists, what's currently in storage, and the feed.
export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  ensureDefaultLogTypes(companyId);
  ensureDefaultLookups(companyId);

  const date = operationalDate(request);
  const overrides = getPermissionOverrides();
  const role = authz.actor.role as Role;
  const meId = authz.actor.userId;
  const canPost = roleCan(role, CAP.post, overrides);
  const canManage = roleCan(role, CAP.manage, overrides);

  const entries = listLogEntries(companyId, date);
  const photos = listPhotosForEntities('log_entry', entries.map((e) => e.id));
  const byEntry = new Map<number, string[]>();
  for (const p of photos) {
    const arr = byEntry.get(p.entity_id) || [];
    arr.push(p.photo);
    byEntry.set(p.entity_id, arr);
  }

  const entryViews = entries.map((e) => ({
    id: e.id,
    type_name: e.type_name,
    type_emoji: e.type_emoji,
    is_alert: !!e.is_alert,
    note: e.note,
    photos: byEntry.get(e.id) || [],
    author_user_id: e.author_user_id,
    author_name: e.author_name,
    created_at: e.created_at,
    updated_at: e.updated_at,
    edited_at: e.edited_at,
    acknowledged_by_name: e.acknowledged_by_name,
    acknowledged_at: e.acknowledged_at,
    storage_item_id: e.storage_item_id,
    can_edit: canManage || (e.author_user_id != null && e.author_user_id === meId),
    // The next shift confirms a heads-up — the author can't vouch for their own.
    can_acknowledge: !!e.is_alert && !e.acknowledged_at && canPost && e.author_user_id !== meId,
  }));

  const storage = listStorageHere(companyId).map((s) => ({
    id: s.id,
    name: s.name,
    item_id: s.item_id,
    amount: s.amount,
    unit: s.unit,
    prepared_on: s.prepared_on,
    location_id: s.location_id,
    location_text: s.location_text,
    use_first: !!s.use_first,
    photo: s.photo,
    added_by_name: s.added_by_name,
    added_at: s.added_at,
    can_edit: canPost,
    can_delete: canPost,
  }));

  const types = listLogTypes(companyId).map((t) => ({
    id: t.id, name: t.name, emoji: t.emoji, is_alert: !!t.is_alert, is_storage: !!t.is_storage,
  }));
  const preppedItems = listLookups(companyId, 'prepped_item').map((l) => ({ id: l.id, name: l.name }));
  const units = listLookups(companyId, 'unit').map((l) => ({ id: l.id, name: l.name }));

  return NextResponse.json({
    operational_date: date,
    is_today: date === berlinToday(),
    recent_dates: recentEntryDates(companyId),
    types,
    prepped_items: preppedItems,
    units,
    storage,
    entries: entryViews,
    me: { actor_name: authz.actor.name, can_post: canPost, can_manage: canManage },
  });
}

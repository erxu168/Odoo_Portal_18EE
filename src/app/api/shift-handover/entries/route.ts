export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, operationalDate, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { listCountLocations, initInventoryTables } from '@/lib/inventory-db';
import { locationPathLabel } from '@/lib/location-tree';
import {
  getDb, ensureDefaultLogTypes, getLogType, createLogEntry, createStorageItem,
  setEntryStorageItem, addPhoto, filterValidPhotos, getIdempotentResult, claimIdempotency,
  setIdempotencyResult, getLogEntry, listPhotos,
} from '@/lib/shift-handover/db';

// POST — add one entry to the log. A "storage" type also pins a persistent
// "In storage now" item. A note OR at least one photo is required.
export async function POST(request: Request) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  ensureDefaultLogTypes(companyId);

  const body = await request.json().catch(() => ({}));
  const type = getLogType(parseInt(String(body?.type_id), 10));
  if (!type || type.company_id !== companyId || !type.active) return jsonError(400, 'Pick a type first.');

  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const photos = filterValidPhotos(body?.photos);
  const isStorage = !!type.is_storage;
  const storageName = isStorage && typeof body?.storage?.name === 'string' ? body.storage.name.trim() : '';
  const useFirst = isStorage && !!body?.storage?.use_first;

  // WHERE it is: a real place from the restaurant's location tree, not typed
  // words. The id is validated against this company's own locations, and the
  // full path is stored ALONGSIDE it so the handover still reads correctly
  // years later, after that shelf has been renamed or taken out.
  let storageLocId: number | null = null;
  let storageLoc = '';
  if (isStorage) {
    const raw = body?.storage?.location_id;
    const id = Number.isInteger(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id) || id <= 0) {
      return jsonError(400, 'Choose where you put it.');
    }
    // The locations live in the inventory schema, which this route never set
    // up — it worked only because the browser happens to GET them first. A
    // direct caller, or a fresh database, hit "no such table" as a 500.
    initInventoryTables();
    const locs = listCountLocations(companyId);
    if (!locs.some((l) => l.id === id)) {
      return jsonError(400, 'That place is not one of this restaurant\u2019s.');
    }
    storageLocId = id;
    storageLoc = locationPathLabel(id, locs);
  }

  if (isStorage && !storageName) return jsonError(400, 'What did you store?');
  if (!note && photos.length === 0 && !(isStorage && storageName)) {
    return jsonError(400, 'Add a note or a photo.');
  }

  // Idempotency: a retried submit returns the first entry instead of duplicating.
  const idemKey = typeof body?.idempotency_key === 'string' ? body.idempotency_key : null;
  if (idemKey) {
    const existing = getIdempotentResult(idemKey, companyId, 'entry');
    if (existing) return NextResponse.json({ entry_id: existing, deduped: true });
  }

  // For a storage post the feed line falls back to "<name> · <where>" if no note typed.
  const finalNote = note || (isStorage ? storageName + (storageLoc ? ` · ${storageLoc}` : '') : null);

  const actor = authz.actor;
  const date = operationalDate(request);
  // The idempotency claim lives INSIDE the transaction, so a concurrent retry hits
  // the UNIQUE constraint and rolls back the whole entry/storage/photo write.
  const tx = getDb().transaction(() => {
    if (idemKey) claimIdempotency(idemKey, companyId, 'entry');
    const entryId = createLogEntry({
      company_id: companyId, operational_date: date,
      type_id: type.id, type_name: type.name, type_emoji: type.emoji, is_alert: !!type.is_alert,
      note: finalNote, author_user_id: actor.userId, author_name: actor.name,
    });
    if (isStorage && storageName) {
      const storageId = createStorageItem({
        company_id: companyId, name: storageName,
        location_id: storageLocId, location_text: storageLoc || null,
        use_first: useFirst, entry_id: entryId, added_by_user_id: actor.userId, added_by_name: actor.name,
      });
      setEntryStorageItem(entryId, companyId, storageId);
    }
    for (const photo of photos) {
      addPhoto({ company_id: companyId, entity_type: 'log_entry', entity_id: entryId, photo, uploaded_by_user_id: actor.userId, uploaded_by_name: actor.name });
    }
    if (idemKey) setIdempotencyResult(idemKey, companyId, 'entry', entryId);
    return entryId;
  });

  let entryId: number;
  try {
    entryId = tx();
  } catch (e) {
    // A colliding idempotency claim means a prior/concurrent identical submit won.
    if (idemKey) {
      const existing = getIdempotentResult(idemKey, companyId, 'entry');
      if (existing) return NextResponse.json({ entry_id: existing, deduped: true });
    }
    console.error('[shift-handover] create entry failed:', e);
    return jsonError(500, 'Could not save your note. Try again.');
  }

  const saved = getLogEntry(entryId);
  return NextResponse.json({
    entry_id: entryId,
    entry: saved ? { ...saved, photos: listPhotos('log_entry', entryId).map((p) => p.photo) } : null,
  });
}

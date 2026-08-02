export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, operationalDate, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { listCountLocations, initInventoryTables } from '@/lib/inventory-db';
import { locationPathLabel } from '@/lib/location-tree';
import { berlinToday, isCanonicalDay } from '@/lib/berlin-date';
import {
  getDb, ensureDefaultLogTypes, ensureDefaultLookups, listLookups, getLookup, getLogType,
  createLogEntry, createStorageItem, setEntryStorageItem, addPhoto, filterValidPhotos,
  getIdempotentResult, claimIdempotency, setIdempotencyResult, getLogEntry, listPhotos, parseAmount,
} from '@/lib/shift-handover/db';

// POST — add one entry to the log. A "storage" (Prepped) type also pins a
// persistent "In storage now" item. A note OR at least one photo is required.
export async function POST(request: Request) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  ensureDefaultLogTypes(companyId);
  ensureDefaultLookups(companyId);

  const body = await request.json().catch(() => ({}));
  const type = getLogType(parseInt(String(body?.type_id), 10));
  if (!type || type.company_id !== companyId || !type.active) return jsonError(400, 'Pick a type first.');

  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const photos = filterValidPhotos(body?.photos);
  const isStorage = !!type.is_storage;
  const typedName = isStorage && typeof body?.storage?.name === 'string' ? body.storage.name.trim() : '';
  const useFirst = isStorage && !!body?.storage?.use_first;

  // Prepped-item details: a picked catalogue item (authoritative name) or an
  // "Other" typed name, a required amount + unit, an optional prepared-on date,
  // and WHERE it is.
  let storageLocId: number | null = null;
  let storageLoc = '';
  let storageName = '';
  let amount: number | null = null;
  let unit: string | null = null;
  let itemId: number | null = null;
  let preparedOn: string | null = null;
  if (isStorage) {
    // Item: a picked catalogue id (name comes from the catalogue) or Other (typed).
    const rawItem = body?.storage?.item_id;
    if (rawItem != null) {
      const lk = getLookup(Number(rawItem));
      if (!lk || lk.company_id !== companyId || lk.kind !== 'prepped_item' || !lk.active) return jsonError(400, 'Pick an item from the list.');
      itemId = lk.id;
      storageName = lk.name;
    } else {
      storageName = typedName;
    }
    if (!storageName) return jsonError(400, 'What did you prep?');

    // Amount + unit are required; unit must be one of this restaurant's units.
    const rawAmt = parseAmount(body?.storage?.amount);
    if (!Number.isFinite(rawAmt) || rawAmt <= 0) return jsonError(400, 'How much did you prep?');
    amount = rawAmt;
    const rawUnit = typeof body?.storage?.unit === 'string' ? body.storage.unit.trim() : '';
    if (!rawUnit) return jsonError(400, 'Pick a unit.');
    if (!listLookups(companyId, 'unit').some((u) => u.name === rawUnit)) return jsonError(400, 'That unit is not one of this restaurant’s.');
    unit = rawUnit;

    // Prepared-on: a real calendar day, today or earlier. Defaults to today ONLY
    // when truly omitted; a supplied null/empty/malformed value is rejected
    // (matches the storage PATCH so the two never diverge).
    const rawDate = body?.storage?.prepared_on;
    if (rawDate === undefined) {
      preparedOn = berlinToday();
    } else if (typeof rawDate === 'string' && isCanonicalDay(rawDate.trim()) && rawDate.trim() <= berlinToday()) {
      preparedOn = rawDate.trim();
    } else {
      return jsonError(400, 'That prepared-on date isn’t valid.');
    }

    // WHERE it is — validated against this company's own locations; the full path
    // is stored alongside so history reads after a shelf is renamed/removed.
    const raw = body?.storage?.location_id;
    const id = Number.isInteger(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id) || id <= 0) return jsonError(400, 'Choose where you put it.');
    initInventoryTables();
    const locs = listCountLocations(companyId);
    if (!locs.some((l) => l.id === id)) return jsonError(400, 'That place is not one of this restaurant’s.');
    storageLocId = id;
    storageLoc = locationPathLabel(id, locs);
  }

  if (!note && photos.length === 0 && !(isStorage && storageName)) {
    return jsonError(400, 'Add a note or a photo.');
  }

  // Idempotency: a retried submit returns the first entry instead of duplicating.
  const idemKey = typeof body?.idempotency_key === 'string' ? body.idempotency_key : null;
  if (idemKey) {
    const existing = getIdempotentResult(idemKey, companyId, 'entry');
    if (existing) return NextResponse.json({ entry_id: existing, deduped: true });
  }

  // Storage feed line falls back to "<name> · <amount> <unit> · <where>" when no note.
  const amountLabel = amount != null && unit ? ` · ${amount} ${unit}` : '';
  const finalNote = note || (isStorage ? `${storageName}${amountLabel}${storageLoc ? ` · ${storageLoc}` : ''}` : null);

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
        amount, unit, prepared_on: preparedOn, item_id: itemId,
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

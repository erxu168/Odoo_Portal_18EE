export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { roleCan, type Role } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import {
  getDb, getLogEntry, updateLogEntryNote, touchEntryEdited, softDeleteLogEntry,
  deactivatePhotosFor, addPhoto, listPhotos, markStorageUsed, filterValidPhotos, clearEntryAck,
} from '@/lib/shift-handover/db';
import type { HandoverActor } from '@/lib/shift-handover/access';

const sameStrings = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** You may change a note if you wrote it, or if you can manage the log. */
function mayEdit(actor: HandoverActor, authorUserId: number | null): boolean {
  if (roleCan(actor.role as Role, CAP.manage, getPermissionOverrides())) return true;
  return authorUserId != null && authorUserId === actor.userId;
}

// PATCH — edit a note and/or replace its photos.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const id = parseInt(params.id, 10);
  const entry = getLogEntry(id);
  if (!entry || entry.company_id !== companyId || !entry.active) return jsonError(404, 'Note not found.');
  if (!mayEdit(authz.actor, entry.author_user_id)) return jsonError(403, 'You can only edit your own notes.');

  const body = await request.json().catch(() => ({}));
  const noteProvided = typeof body?.note === 'string';
  const photosProvided = Array.isArray(body?.photos);
  if (!noteProvided && !photosProvided) {
    return NextResponse.json({ ok: true, photos: listPhotos('log_entry', id).map((p) => p.photo) });
  }
  const newPhotos = photosProvided ? filterValidPhotos(body.photos) : null;

  // Re-read + validate + write in ONE immediate (write-locked) transaction, so two
  // concurrent edits can't each pass a stale check and leave the note empty, and a
  // read receipt can't outlive content it never saw.
  const run = getDb().transaction(() => {
    const cur = getLogEntry(id);
    if (!cur || cur.company_id !== companyId || !cur.active) throw new Error('NOT_FOUND');
    const curPhotos = listPhotos('log_entry', id).map((p) => p.photo);
    const resultingNote = noteProvided ? String(body.note).trim() : (cur.note ?? '').trim();
    const resultingPhotos = photosProvided ? newPhotos! : curPhotos;
    if (!resultingNote && resultingPhotos.length === 0) throw new Error('EMPTY');

    // Only mutate on a genuine change, so opening + saving an acknowledged alert
    // unchanged doesn't wipe its "Seen by" or needlessly recreate its photos.
    const noteChanged = noteProvided && resultingNote !== (cur.note ?? '').trim();
    const photosChanged = photosProvided && !sameStrings(newPhotos!, curPhotos);
    if (!noteChanged && !photosChanged) return;

    if (noteChanged) updateLogEntryNote(id, companyId, resultingNote || null);
    if (photosChanged) {
      deactivatePhotosFor('log_entry', id, companyId);
      for (const photo of newPhotos!) {
        addPhoto({ company_id: companyId, entity_type: 'log_entry', entity_id: id, photo, uploaded_by_user_id: authz.actor.userId, uploaded_by_name: authz.actor.name });
      }
      if (!noteChanged) touchEntryEdited(id, companyId);
    }
    // A read receipt can't outlive content it never saw.
    if (cur.is_alert && cur.acknowledged_at) clearEntryAck(id, companyId);
  });

  try {
    run.immediate();
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return jsonError(404, 'Note not found.');
    if (msg === 'EMPTY') return jsonError(400, 'A note needs some text or a photo.');
    console.error('[shift-handover] edit entry failed:', e);
    return jsonError(500, 'Could not save the change.');
  }
  return NextResponse.json({ ok: true, photos: listPhotos('log_entry', id).map((p) => p.photo) });
}

// DELETE — remove a note (soft delete). If it pinned a storage item, take that down too.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const id = parseInt(params.id, 10);
  const entry = getLogEntry(id);
  if (!entry || entry.company_id !== companyId || !entry.active) return jsonError(404, 'Note not found.');
  if (!mayEdit(authz.actor, entry.author_user_id)) return jsonError(403, 'You can only delete your own notes.');

  const run = getDb().transaction(() => {
    softDeleteLogEntry(id, companyId);
    if (entry.storage_item_id) markStorageUsed(entry.storage_item_id, companyId, authz.actor);
  });
  run.immediate();
  return NextResponse.json({ ok: true });
}

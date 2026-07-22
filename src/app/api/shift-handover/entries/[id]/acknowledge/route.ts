export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getDb, getLogEntry, acknowledgeEntry } from '@/lib/shift-handover/db';

// POST — the incoming shift confirms it has read a heads-up (alert) note.
// The client sends the content version (updated_at) it actually saw; if the note
// was edited since, the ack is rejected (409) so it can't vouch for unseen content.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const id = parseInt(params.id, 10);
  const body = await request.json().catch(() => ({}));
  const knownUpdatedAt = typeof body?.known_updated_at === 'string' ? body.known_updated_at : null;

  const run = getDb().transaction(() => {
    const cur = getLogEntry(id);
    if (!cur || cur.company_id !== companyId || !cur.active) throw new Error('NOT_FOUND');
    if (!cur.is_alert) throw new Error('NOT_ALERT');
    if (cur.acknowledged_at) return; // already acknowledged — idempotent
    // Required, not optional: without the exact version the caller saw, we can't
    // prove they read the current content, so refuse rather than trust the client.
    if (cur.updated_at !== knownUpdatedAt) throw new Error('STALE');
    acknowledgeEntry(id, companyId, authz.actor);
  });

  try {
    run.immediate();
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return jsonError(404, 'Note not found.');
    if (msg === 'NOT_ALERT') return jsonError(400, 'This note does not need acknowledging.');
    if (msg === 'STALE') return jsonError(409, 'This note was just edited — take another look.');
    console.error('[shift-handover] acknowledge failed:', e);
    return jsonError(500, 'Could not acknowledge.');
  }

  const after = getLogEntry(id);
  return NextResponse.json({
    ok: true,
    acknowledged_by_name: after?.acknowledged_by_name ?? null,
    acknowledged_at: after?.acknowledged_at ?? null,
  });
}

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getDb, getLogType, updateLogType, listLogTypes, countActiveStorageTypes } from '@/lib/shift-handover/db';

// PATCH — rename a type, change its emoji, its alert flag, or its order.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const type = getLogType(parseInt(params.id, 10));
  if (!type || type.company_id !== companyId || !type.active) return jsonError(404, 'Type not found.');

  const body = await request.json().catch(() => ({}));
  const patch: { name?: string; emoji?: string; is_alert?: boolean; sort_order?: number } = {};
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body?.emoji === 'string' && body.emoji.trim()) patch.emoji = body.emoji.trim();
  if (typeof body?.is_alert === 'boolean') patch.is_alert = body.is_alert;
  if (Number.isFinite(body?.sort_order)) patch.sort_order = body.sort_order;
  updateLogType(type.id, companyId, patch);
  return NextResponse.json({ ok: true });
}

// DELETE — hide a type from the add sheet (soft delete; posted notes keep their label).
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const id = parseInt(params.id, 10);
  // Count + guard + deactivate in ONE immediate transaction, so concurrent deletes
  // can't each see "more than one" and then remove them all.
  const run = getDb().transaction(() => {
    const cur = getLogType(id);
    if (!cur || cur.company_id !== companyId || !cur.active) throw new Error('NOT_FOUND');
    // Keep at least one type so staff can always post.
    if (listLogTypes(companyId).length <= 1) throw new Error('LAST_TYPE');
    // Don't let the last storage-capable type go — it would disable "In storage now"
    // with no way to get it back (new types can't be marked as storage).
    if (cur.is_storage && countActiveStorageTypes(companyId) <= 1) throw new Error('LAST_STORAGE');
    updateLogType(id, companyId, { active: false });
  });

  try {
    run.immediate();
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return jsonError(404, 'Type not found.');
    if (msg === 'LAST_TYPE') return jsonError(400, 'Keep at least one type.');
    if (msg === 'LAST_STORAGE') return jsonError(400, 'This type keeps “In storage now” working — it can’t be removed.');
    console.error('[shift-handover] delete type failed:', e);
    return jsonError(500, 'Could not remove the type.');
  }
  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import {
  getDb, ensureDefaultLookups, listLookups, getLookup, createLookup, updateLookup,
  nextLookupSortOrder, countActiveLookups, findLookupByName, type LookupKind,
} from '@/lib/shift-handover/db';

// URL slug → stored kind. Allow-listed so no arbitrary kind can be reached.
const KINDS: Record<string, LookupKind> = { 'prepped-items': 'prepped_item', units: 'unit' };
const NOUN: Record<LookupKind, string> = { prepped_item: 'item', unit: 'unit' };

function kindOf(params: { kind: string }): LookupKind | null {
  return KINDS[params.kind] ?? null;
}

// GET — the list, for the add sheet and the manager Setup screen.
export async function GET(request: Request, { params }: { params: { kind: string } }) {
  const kind = kindOf(params);
  if (!kind) return jsonError(404, 'Unknown list.');
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  ensureDefaultLookups(companyId);
  const items = listLookups(companyId, kind).map((l) => ({ id: l.id, name: l.name, sort_order: l.sort_order }));
  return NextResponse.json({ items });
}

// POST — add a value (or reactivate a retired one with the same name).
export async function POST(request: Request, { params }: { params: { kind: string } }) {
  const kind = kindOf(params);
  if (!kind) return jsonError(404, 'Unknown list.');
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return jsonError(400, `Give the ${NOUN[kind]} a name.`);
  const existing = findLookupByName(companyId, kind, name);
  if (existing && existing.active) return jsonError(409, `That ${NOUN[kind]} is already on the list.`);
  const id = createLookup({ company_id: companyId, kind, name, sort_order: nextLookupSortOrder(companyId, kind) });
  return NextResponse.json({ ok: true, id });
}

// PATCH — rename or reorder one value.
export async function PATCH(request: Request, { params }: { params: { kind: string } }) {
  const kind = kindOf(params);
  if (!kind) return jsonError(404, 'Unknown list.');
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const body = await request.json().catch(() => ({}));
  const id = parseInt(String(body?.id), 10);
  const row = getLookup(id);
  if (!row || row.company_id !== companyId || row.kind !== kind || !row.active) return jsonError(404, 'Not found.');

  const patch: { name?: string; sort_order?: number } = {};
  if (typeof body?.name === 'string' && body.name.trim()) {
    const name = body.name.trim();
    const clash = findLookupByName(companyId, kind, name);
    if (clash && clash.id !== id && clash.active) return jsonError(409, `Another ${NOUN[kind]} already has that name.`);
    patch.name = name;
  }
  if (Number.isFinite(body?.sort_order)) patch.sort_order = Number(body.sort_order);
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });
  try {
    updateLookup(id, companyId, patch);
  } catch {
    return jsonError(409, `Another ${NOUN[kind]} already has that name.`);
  }
  return NextResponse.json({ ok: true });
}

// DELETE ?id= — retire a value (soft). Keeps at least one so the dropdown is never empty.
export async function DELETE(request: Request, { params }: { params: { kind: string } }) {
  const kind = kindOf(params);
  if (!kind) return jsonError(404, 'Unknown list.');
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const id = parseInt(new URL(request.url).searchParams.get('id') || '0', 10);
  // Count + retire in ONE immediate transaction so two deletes can't both see
  // "more than one left" and empty the list.
  const run = getDb().transaction(() => {
    const cur = getLookup(id);
    if (!cur || cur.company_id !== companyId || cur.kind !== kind || !cur.active) throw new Error('NOT_FOUND');
    if (countActiveLookups(companyId, kind) <= 1) throw new Error('LAST');
    updateLookup(id, companyId, { active: false });
  });
  try {
    run.immediate();
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (m === 'NOT_FOUND') return jsonError(404, 'Not found.');
    if (m === 'LAST') return jsonError(400, `Keep at least one ${NOUN[kind]}.`);
    console.error('[shift-handover] delete lookup failed:', e);
    return jsonError(500, 'Could not remove it.');
  }
  return NextResponse.json({ ok: true });
}

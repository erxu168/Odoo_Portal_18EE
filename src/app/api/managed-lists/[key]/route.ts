export const dynamic = 'force-dynamic';
/**
 * /api/managed-lists/[key] — one endpoint for every registry-listed managed list.
 * GET    — list items (+ meta: caps, warning, and whether THIS user may write)
 * POST   — add an item        body: { label }               (write-gated)
 * PATCH  — rename an item      body: { id, label }           (write-gated)
 * DELETE — remove an item      ?id=                          (write-gated)
 *
 * Fail-closed on an unknown key (only registered lists are reachable — this is
 * the allow-list that keeps structural/legal enums out). Global lists are keyed
 * to company 0 and gated by role; per-company lists resolve + authorize the
 * active company like the rest of the app.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, type PortalUser } from '@/lib/db';
import { canAccessCompany, resolveScopedCompany } from '@/lib/inventory-access';
import { getManagedListDef, type ManagedListDef } from '@/lib/managed-lists/registry';
import { initManagedLists, listManagedItems, addManagedItem, renameManagedItem, deleteManagedItem } from '@/lib/managed-lists/db';

function canWrite(user: PortalUser, def: ManagedListDef): boolean {
  return def.permission === 'admin'
    ? hasRole(user, 'admin')
    : roleCan(user.role, def.permission, getPermissionOverrides());
}

/** Resolve the company_id this request operates on, or null if denied/invalid.
 *  Global lists are always company 0. For company lists a supplied company_id
 *  must be a COMPLETE positive integer (reject "12junk"); omitted falls back to
 *  the caller's own company. */
function resolveCompany(def: ManagedListDef, user: PortalUser, requestedRaw: string | null): number | null {
  if (def.scope === 'global') return 0;
  let requested = 0;
  if (requestedRaw != null && requestedRaw !== '') {
    if (!/^\d+$/.test(requestedRaw)) return null;   // junk company_id → deny, never coerce
    requested = parseInt(requestedRaw, 10);
  }
  if (requested && !canAccessCompany(user, requested)) return null;
  const c = resolveScopedCompany(user, requested || null);
  return c ?? null;
}

export async function GET(request: Request, { params }: { params: { key: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const def = getManagedListDef(params.key);
  if (!def) return NextResponse.json({ error: 'Unknown list' }, { status: 404 });
  initManagedLists();

  const { searchParams } = new URL(request.url);
  const companyId = resolveCompany(def, user, searchParams.get('company_id'));
  if (companyId == null) return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });

  const items = listManagedItems(def.key, companyId, def.seed);
  return NextResponse.json({
    items,
    meta: {
      key: def.key, label: def.label, description: def.description,
      scope: def.scope, warn: def.warn || null, caps: def.caps,
      canWrite: canWrite(user, def),
    },
  });
}

export async function POST(request: Request, { params }: { params: { key: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const def = getManagedListDef(params.key);
  if (!def) return NextResponse.json({ error: 'Unknown list' }, { status: 404 });
  if (!def.caps.add || !canWrite(user, def)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  initManagedLists();

  const { searchParams } = new URL(request.url);
  const companyId = resolveCompany(def, user, searchParams.get('company_id'));
  if (companyId == null) return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const label = typeof (body as { label?: unknown }).label === 'string' ? (body as { label: string }).label : '';
  const row = addManagedItem(def.key, companyId, label, user.id);
  if (!row) return NextResponse.json({ error: 'That already exists, or the name is invalid' }, { status: 400 });
  return NextResponse.json({ item: row }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: { key: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const def = getManagedListDef(params.key);
  if (!def) return NextResponse.json({ error: 'Unknown list' }, { status: 404 });
  if (!def.caps.rename || !canWrite(user, def)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  initManagedLists();

  const { searchParams } = new URL(request.url);
  const companyId = resolveCompany(def, user, searchParams.get('company_id'));
  if (companyId == null) return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const id = Number((body as { id?: unknown }).id);
  const label = typeof (body as { label?: unknown }).label === 'string' ? (body as { label: string }).label : '';
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid id is required' }, { status: 400 });
  if (!label.trim()) return NextResponse.json({ error: 'A name is required' }, { status: 400 });
  const res = renameManagedItem(id, def.key, companyId, label);
  if (!res.ok && res.dupe) return NextResponse.json({ error: 'That already exists' }, { status: 409 });
  if (!res.ok) return NextResponse.json({ error: 'Not found or invalid name' }, { status: 404 });
  return NextResponse.json({ message: 'Renamed' });
}

export async function DELETE(request: Request, { params }: { params: { key: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const def = getManagedListDef(params.key);
  if (!def) return NextResponse.json({ error: 'Unknown list' }, { status: 404 });
  if (!def.caps.delete || !canWrite(user, def)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  initManagedLists();

  const { searchParams } = new URL(request.url);
  const companyId = resolveCompany(def, user, searchParams.get('company_id'));
  if (companyId == null) return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });

  const idRaw = searchParams.get('id');
  if (!idRaw || !/^\d+$/.test(idRaw)) return NextResponse.json({ error: 'A valid id is required' }, { status: 400 });
  const ok = deleteManagedItem(parseInt(idRaw, 10), def.key, companyId);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ message: 'Removed' });
}

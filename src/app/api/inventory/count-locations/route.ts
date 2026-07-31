export const dynamic = 'force-dynamic';
/**
 * /api/inventory/count-locations
 * GET    — list a company's count locations (flat; client builds the tree)
 * POST   — create a location (manager/admin)
 * PUT    — update a location incl. reorder (manager/admin)
 * DELETE — remove a location + its children & placements (manager/admin)
 *
 * The location hierarchy is portal-owned (SQLite). Odoo stays source of truth
 * for stock; a location optionally references a real stock.location.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { markerOnlyKinds } from '@/lib/inventory-floorplan/db';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import {
  initInventoryTables, createCountLocation, updateCountLocation,
  deleteCountLocation, listCountLocations, getCountLocation,
} from '@/lib/inventory-db';
import { canAccessCompany, resolveScopedCompany } from '@/lib/inventory-access';

const KEY = 'inventory.location.manage';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);

  // By-id: the canonical location page fetches one record (it only knows the
  // id from the URL). Scoped by the row's own company so cross-company reads 404.
  const idRaw = searchParams.get('id');
  if (idRaw != null) {
    if (!/^\d+$/.test(idRaw)) return NextResponse.json({ error: 'Invalid location id' }, { status: 400 });
    const idParam = parseInt(idRaw, 10);
    if (idParam <= 0) return NextResponse.json({ error: 'Invalid location id' }, { status: 400 });
    const loc = getCountLocation(idParam);
    if (!loc || !canAccessCompany(user, loc.company_id))
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    return NextResponse.json({ location: loc });
  }

  // No company on the query? Fall back to the one chosen in the blue ribbon —
  // that picker is the source of truth for which restaurant you are looking at.
  // Without this an unrestricted admin got an EMPTY list, because
  // resolveScopedCompany answers null for "can see every company".
  const cookieCompany = parseInt(cookies().get('kw_company_id')?.value || '0', 10) || null;
  const requested = (parseInt(searchParams.get('company_id') || '0', 10) || null) ?? null;
  if (requested && !canAccessCompany(user, requested))
    return NextResponse.json({ error: 'Location not found' }, { status: 404 });
  const fallback = cookieCompany && canAccessCompany(user, cookieCompany) ? cookieCompany : null;
  const companyId = resolveScopedCompany(user, requested ?? fallback);
  if (!companyId) return NextResponse.json({ locations: [] });

  const all = listCountLocations(companyId);
  // ?storage_only=1 — for the "where does this product live?" picker. Types the
  // manager marked as MARKERS (a shut-off valve, a fuse box) are not places
  // anything is stored, so they are dropped here rather than filtered in every
  // screen. Their children go too: nothing should be nested under a marker, and
  // a stray child would otherwise be offered without its parent.
  if (searchParams.get('storage_only') === '1') {
    const markers = new Set(markerOnlyKinds(companyId).map(k => k.toLowerCase()));
    const byId = new Map(all.map(l => [l.id, l]));
    const isUnderMarker = (loc: { id: number; parent_id: number | null; kind: string }): boolean => {
      const seen = new Set<number>();
      let cur: typeof loc | undefined = loc;
      while (cur && !seen.has(cur.id)) {
        if (markers.has((cur.kind || '').toLowerCase())) return true;
        seen.add(cur.id);
        cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
      }
      return false;
    };
    return NextResponse.json({ locations: all.filter(l => !isUnderMarker(l)), marker_kinds: Array.from(markers) });
  }
  return NextResponse.json({ locations: all, marker_kinds: markerOnlyKinds(companyId) });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden — manager role required' }, { status: 403 });
  initInventoryTables();

  const body = await request.json();
  const requested = body.company_id != null ? Number(body.company_id) : null;
  if (requested && !canAccessCompany(user, requested))
    return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
  const companyId = resolveScopedCompany(user, requested);
  if (!companyId) return NextResponse.json({ error: 'No company available' }, { status: 400 });
  if (!body.name || !String(body.name).trim())
    return NextResponse.json({ error: 'name is required' }, { status: 400 });

  // A child's parent must exist in the SAME company (no cross-company nesting).
  if (body.parent_id != null) {
    const parent = getCountLocation(body.parent_id);
    if (!parent || parent.company_id !== companyId)
      return NextResponse.json({ error: 'Invalid parent location' }, { status: 400 });
  }

  const id = createCountLocation({
    parent_id: body.parent_id ?? null,
    company_id: companyId,
    name: String(body.name).trim(),
    kind: body.kind || 'area',
    description: body.description ?? null,
    photo: body.photo ?? null,
    odoo_location_id: body.odoo_location_id ?? null,
    created_by: user.id,
  });
  return NextResponse.json({ id }, { status: 201 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  initInventoryTables();

  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Derive the company from the target row so multi-company managers edit the
  // right record; verify the caller is allowed that company.
  const loc = getCountLocation(id);
  if (!loc || !canAccessCompany(user, loc.company_id))
    return NextResponse.json({ error: 'Location not found' }, { status: 404 });

  // Never let a client change company or re-parent (re-parenting isn't a Phase 1
  // feature and could create a cycle that breaks cascade delete).
  const u = updates as Record<string, unknown>;
  delete u.company_id; delete u.parent_id;
  updateCountLocation(id, loc.company_id, updates);
  return NextResponse.json({ message: 'Location updated' });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') || '0', 10);
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const loc = getCountLocation(id);
  if (!loc || !canAccessCompany(user, loc.company_id))
    return NextResponse.json({ error: 'Location not found' }, { status: 404 });

  // Every id that went, so the screen can drop the room AND its shelves without
  // re-fetching — a re-fetch re-mounts the list and loses the scroll position.
  const removed = deleteCountLocation(id, loc.company_id);
  return NextResponse.json({ message: 'Location removed', removed_ids: removed });
}

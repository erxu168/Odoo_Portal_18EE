export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplan-anchors/[id]
 * PUT    — move an anchor (edit-mode drag): { polygon, cx, cy }
 * DELETE — remove an anchor from the map. The SPOT SURVIVES — removing a
 *          marker never deletes inventory data; the spot just loses its place
 *          on the plan until placed again.
 */
import { NextResponse } from 'next/server';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import { initFloorplanTables, getAnchor, getRevision, getFloor, updateAnchorPosition, updateAnchorPin, deleteAnchor } from '@/lib/inventory-floorplan/db';
import { validStoredPolygon } from '@/lib/inventory-floorplan/geometry';
import { moduleForbidden } from '@/lib/module-access';

function loadAuthorized(idRaw: string, user: Parameters<typeof canAccessCompany>[0]) {
  const id = parseInt(idRaw, 10);
  const anchor = Number.isFinite(id) && id > 0 ? getAnchor(id) : null;
  if (!anchor) return null;
  const revision = getRevision(anchor.revision_id);
  const floor = revision ? getFloor(revision.floor_id) : null;
  if (!floor || !canAccessCompany(user, floor.company_id)) return null;
  // History is immutable: only the LIVE plan's markers may move or vanish.
  if (!floor.active || revision!.status !== 'published' || floor.current_revision_id !== revision!.id) return null;
  return { anchor, revision: revision!, floor };
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const loaded = loadAuthorized(params.id, authz.user);
  if (!loaded) return NextResponse.json({ error: 'Marker not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const cx = Number(body?.cx), cy = Number(body?.cy);
  if (!validStoredPolygon(body?.polygon) || !(cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1)) {
    return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
  }
  updateAnchorPosition(loaded.anchor.id, { polygon: body.polygon, cx, cy });
  return NextResponse.json({ message: 'Position updated' });
}

/**
 * PATCH — move only the ICON (the leader-line pull-out): { pinCx, pinCy },
 * or { pinCx: null } to snap it back onto its spot.
 *
 * Deliberately NOT part of PUT. PUT moves the SPOT, which is inventory data;
 * this moves where the icon is drawn, which is decoration. Keeping them apart
 * means a bug in the cosmetic path can never relocate a real spot.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const loaded = loadAuthorized(params.id, authz.user);
  if (!loaded) return NextResponse.json({ error: 'Marker not found' }, { status: 404 });

  // Only a marker can be pulled out. An 'overlay' anchor is a shape drawn on
  // the plan, not an icon, so there is nothing to move and nothing to point.
  if (loaded.anchor.display !== 'pin') {
    return NextResponse.json({ error: 'This marker cannot be pulled out' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid position' }, { status: 400 });

  // Snap back requires BOTH coordinates to be null. Half a pair is not a
  // position and must not be read as an instruction to clear the pull-out —
  // that would silently discard a placement because one value went missing.
  if (body.pinCx === null && body.pinCy === null) {
    if (!updateAnchorPin(loaded.anchor.id, null)) {
      return NextResponse.json({ error: 'Marker not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Icon back on its spot' });
  }

  // typeof + isFinite, NOT Number(): Number(null)/Number(false)/Number('') are
  // all 0, which would silently park the icon in the plan's top-left corner.
  const x = body.pinCx, y = body.pinCy;
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!ok(x) || !ok(y)) {
    return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
  }
  if (!updateAnchorPin(loaded.anchor.id, { x, y })) {
    return NextResponse.json({ error: 'Marker not found' }, { status: 404 });
  }
  return NextResponse.json({ message: 'Icon moved' });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const loaded = loadAuthorized(params.id, authz.user);
  if (!loaded) return NextResponse.json({ error: 'Marker not found' }, { status: 404 });

  deleteAnchor(loaded.anchor.id);
  return NextResponse.json({ message: 'Removed from the map — the spot itself is untouched' });
}

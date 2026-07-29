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
import { initFloorplanTables, getAnchor, getRevision, getFloor, updateAnchorPosition, deleteAnchor } from '@/lib/inventory-floorplan/db';
import { validStoredPolygon } from '@/lib/inventory-floorplan/geometry';

function loadAuthorized(idRaw: string, user: Parameters<typeof canAccessCompany>[0]) {
  const id = parseInt(idRaw, 10);
  const anchor = Number.isFinite(id) && id > 0 ? getAnchor(id) : null;
  if (!anchor) return null;
  const revision = getRevision(anchor.revision_id);
  const floor = revision ? getFloor(revision.floor_id) : null;
  if (!floor || !canAccessCompany(user, floor.company_id)) return null;
  return { anchor, revision: revision!, floor };
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
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

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const loaded = loadAuthorized(params.id, authz.user);
  if (!loaded) return NextResponse.json({ error: 'Marker not found' }, { status: 404 });

  deleteAnchor(loaded.anchor.id);
  return NextResponse.json({ message: 'Removed from the map — the spot itself is untouched' });
}

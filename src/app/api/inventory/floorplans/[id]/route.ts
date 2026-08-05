export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplans/[id]
 * PATCH  — rename / re-code / reorder a floor (manage)
 * DELETE — archive a floor (manage). Never a hard delete: revisions, anchors
 *          and history stay; the floor just leaves every staff surface.
 */
import { NextResponse } from 'next/server';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import { initFloorplanTables, getFloor, updateFloor } from '@/lib/inventory-floorplan/db';
import { moduleForbidden } from '@/lib/module-access';

function loadAuthorizedFloor(idRaw: string, authz: { ok: true; user: Parameters<typeof canAccessCompany>[0] }) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const floor = getFloor(id);
  if (!floor || !canAccessCompany(authz.user, floor.company_id)) return null;
  return floor;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const floor = loadAuthorizedFloor(params.id, authz);
  if (!floor) return NextResponse.json({ error: 'Floor not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const updates: { name?: string; code?: string; sort_order?: number } = {};
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return NextResponse.json({ error: 'The floor name cannot be empty' }, { status: 400 });
    updates.name = String(body.name);
  }
  if (body.code !== undefined) updates.code = String(body.code).slice(0, 8);
  if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) updates.sort_order = Number(body.sort_order);

  try {
    updateFloor(floor.id, updates);
  } catch (e: unknown) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return NextResponse.json({ error: 'A floor with that name already exists here' }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ message: 'Floor updated' });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const floor = loadAuthorizedFloor(params.id, authz);
  if (!floor) return NextResponse.json({ error: 'Floor not found' }, { status: 404 });

  updateFloor(floor.id, { active: 0 });
  return NextResponse.json({ message: 'Floor archived' });
}

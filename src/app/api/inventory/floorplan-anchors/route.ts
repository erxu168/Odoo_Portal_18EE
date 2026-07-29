export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplan-anchors
 * POST — place a NEW spot on the published plan from edit mode (manage):
 *        { floorId, x, y, typeKey, code, roomLocationId? }
 *        Creates the count_locations row (the same insert path the Locations
 *        screen uses) + a 'pin' anchor on the floor's current revision.
 *        App-added spots have no drawn label underneath, so they render as
 *        visible icon pills.
 */
import { NextResponse } from 'next/server';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import { initFloorplanTables, getFloor, getRevision, createAnchor } from '@/lib/inventory-floorplan/db';
import { initInventoryTables, createCountLocation, getCountLocation, listCountLocations } from '@/lib/inventory-db';
import { normalizeCode } from '@/lib/inventory-floorplan/geometry';
import { getDb } from '@/lib/db';

const PIN_HALF_W = 0.012; // nominal tap polygon around an app-placed pin
const PIN_HALF_H = 0.008;

export async function POST(request: Request) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initInventoryTables();
  initFloorplanTables();

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const floor = Number(body.floorId) > 0 ? getFloor(Number(body.floorId)) : null;
  if (!floor || !floor.active || !canAccessCompany(authz.user, floor.company_id)) {
    return NextResponse.json({ error: 'Floor not found' }, { status: 404 });
  }
  const revision = floor.current_revision_id ? getRevision(floor.current_revision_id) : null;
  if (!revision || revision.status !== 'published') {
    return NextResponse.json({ error: 'This floor has no published plan yet' }, { status: 409 });
  }

  const x = Number(body.x), y = Number(body.y);
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
    return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
  }
  const code = normalizeCode(String(body.code ?? ''));
  if (!code || code.length > 60) return NextResponse.json({ error: 'A spot code is required' }, { status: 400 });
  const typeKey = String(body.typeKey ?? '').slice(0, 40);
  if (!typeKey) return NextResponse.json({ error: 'Pick a type' }, { status: 400 });

  let roomId: number | null = null;
  if (body.roomLocationId != null) {
    const room = getCountLocation(Number(body.roomLocationId));
    if (!room || room.company_id !== floor.company_id) {
      return NextResponse.json({ error: 'Invalid room' }, { status: 400 });
    }
    roomId = room.id;
  }

  // Same-room duplicate guard, same rule as publish.
  const siblings = (listCountLocations(floor.company_id) as Array<{ name: string; parent_id: number | null }>)
    .filter(l => l.parent_id === roomId);
  if (siblings.some(s => normalizeCode(s.name) === code)) {
    return NextResponse.json({ error: `“${code}” already exists in that room — pick another code` }, { status: 409 });
  }

  const db = getDb();
  let locationId = 0;
  let anchorId = 0;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  db.transaction(() => {
    locationId = createCountLocation({
      parent_id: roomId, company_id: floor.company_id, name: code, kind: typeKey,
      description: null, photo: null, odoo_location_id: null, created_by: authz.actor.userId,
    });
    anchorId = createAnchor({
      revision_id: revision.id,
      count_location_id: locationId,
      polygon: [
        { x: clamp(x - PIN_HALF_W), y: clamp(y - PIN_HALF_H) },
        { x: clamp(x + PIN_HALF_W), y: clamp(y - PIN_HALF_H) },
        { x: clamp(x + PIN_HALF_W), y: clamp(y + PIN_HALF_H) },
        { x: clamp(x - PIN_HALF_W), y: clamp(y + PIN_HALF_H) },
      ],
      cx: x, cy: y, label: code, display: 'pin', is_primary: true,
      created_by: authz.actor.userId,
    });
  })();

  return NextResponse.json({ locationId, anchorId }, { status: 201 });
}

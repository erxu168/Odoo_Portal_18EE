export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplan/spots/[locationId]/children
 * POST — create several sub-places INSIDE this one in one go:
 *        { count, labelPattern, typeKey, startAt? }
 *
 * A fridge with four shelf levels should not need four map markers or four
 * trips through a form: the fridge carries the marker, the levels live inside
 * it. Names follow the pattern ("Level 1..4"), duplicates inside the same
 * parent are refused, and everything lands in ONE transaction.
 */
import { NextResponse } from 'next/server';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import { initInventoryTables, getCountLocation, listCountLocations, createCountLocation } from '@/lib/inventory-db';
import { normalizeCode } from '@/lib/inventory-floorplan/geometry';
import { getDb } from '@/lib/db';

const MAX_CHILDREN = 40;

export async function POST(request: Request, { params }: { params: { locationId: string } }) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initInventoryTables();

  if (!/^\d+$/.test(params.locationId)) return NextResponse.json({ error: 'Invalid place' }, { status: 400 });
  const parent = getCountLocation(parseInt(params.locationId, 10));
  if (!parent || !canAccessCompany(authz.user, parent.company_id) || !parent.active) {
    return NextResponse.json({ error: 'Place not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const count = Number(body?.count);
  const startAt = Number.isInteger(Number(body?.startAt)) ? Number(body.startAt) : 1;
  const word = String(body?.labelPattern ?? 'Level').trim().slice(0, 24) || 'Level';
  const typeKey = String(body?.typeKey ?? 'shelf').trim().slice(0, 40) || 'shelf';
  if (!Number.isInteger(count) || count < 1 || count > MAX_CHILDREN) {
    return NextResponse.json({ error: `Pick between 1 and ${MAX_CHILDREN}` }, { status: 400 });
  }

  const existing = (listCountLocations(parent.company_id) as Array<{ name: string; parent_id: number | null }>)
    .filter(l => l.parent_id === parent.id)
    .map(l => normalizeCode(l.name));

  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `${word} ${startAt + i}`;
    if (existing.includes(normalizeCode(name)) || names.some(n => normalizeCode(n) === normalizeCode(name))) {
      return NextResponse.json({ error: `“${name}” already exists in ${parent.name}` }, { status: 409 });
    }
    names.push(name);
  }

  const db = getDb();
  const ids: number[] = [];
  db.transaction(() => {
    for (const name of names) {
      ids.push(createCountLocation({
        parent_id: parent.id, company_id: parent.company_id, name, kind: typeKey,
        description: null, photo: null, odoo_location_id: null, created_by: authz.actor.userId,
      }));
    }
  })();

  return NextResponse.json({ created: ids.length, ids }, { status: 201 });
}

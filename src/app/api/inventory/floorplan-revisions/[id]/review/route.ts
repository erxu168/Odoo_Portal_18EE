export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplan-revisions/[id]/review
 * GET — the draft revision + its candidates for the review screen (manage)
 * PUT — save candidate dispositions (manage, DRAFT revisions only)
 */
import { NextResponse } from 'next/server';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import {
  initFloorplanTables, getRevision, getFloor, listCandidates, updateCandidate,
} from '@/lib/inventory-floorplan/db';
import { validStoredPolygon } from '@/lib/inventory-floorplan/geometry';
import { getDb } from '@/lib/db';

const DISPOSITIONS = new Set(['pending', 'create', 'linked', 'ignored']);
const KINDS = new Set(['spot', 'room', 'other']);

function loadAuthorized(idRaw: string, user: Parameters<typeof canAccessCompany>[0]) {
  const id = parseInt(idRaw, 10);
  const revision = Number.isFinite(id) && id > 0 ? getRevision(id) : null;
  if (!revision) return null;
  const floor = getFloor(revision.floor_id);
  if (!floor || !canAccessCompany(user, floor.company_id)) return null;
  return { revision, floor };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const loaded = loadAuthorized(params.id, authz.user);
  if (!loaded) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });

  return NextResponse.json({
    revision: {
      id: loaded.revision.id,
      floor_id: loaded.revision.floor_id,
      revision_no: loaded.revision.revision_no,
      status: loaded.revision.status,
      version: loaded.revision.version,
      raster_url: `/api/inventory/floorplans/assets/${loaded.revision.id}/raster`,
      raster_width: loaded.revision.raster_width,
      raster_height: loaded.revision.raster_height,
    },
    floor: { id: loaded.floor.id, name: loaded.floor.name, code: loaded.floor.code, company_id: loaded.floor.company_id },
    candidates: listCandidates(loaded.revision.id),
  });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const loaded = loadAuthorized(params.id, authz.user);
  if (!loaded) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  if (loaded.revision.status !== 'draft') {
    return NextResponse.json({ error: 'This plan version is already published — upload a new version to change it' }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const updates = body?.updates;
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 1200) {
    return NextResponse.json({ error: 'Invalid review changes' }, { status: 400 });
  }

  const ownIds = new Set(listCandidates(loaded.revision.id).map(c => c.id));
  for (const u of updates) {
    const id = Number(u?.id);
    if (!ownIds.has(id)) return NextResponse.json({ error: 'Unknown detected label in review changes' }, { status: 400 });
    if (u.disposition !== undefined && !DISPOSITIONS.has(String(u.disposition))) {
      return NextResponse.json({ error: 'Invalid review decision' }, { status: 400 });
    }
    if (u.polygon !== undefined && !validStoredPolygon(u.polygon)) {
      return NextResponse.json({ error: 'Invalid label position' }, { status: 400 });
    }
    if (u.linked_location_id !== undefined && u.linked_location_id !== null && !(Number(u.linked_location_id) > 0)) {
      return NextResponse.json({ error: 'Invalid linked spot' }, { status: 400 });
    }
    if (u.proposed_kind !== undefined && !KINDS.has(String(u.proposed_kind))) {
      return NextResponse.json({ error: 'Invalid label kind' }, { status: 400 });
    }
  }

  // One transaction: re-check draft status INSIDE it and bump the optimistic
  // version, so two reviewers cannot silently interleave (Codex finding #6).
  // The caller publishes with the RETURNED version.
  const db = getDb();
  let newVersion = 0;
  let stillDraft = true;
  db.transaction(() => {
    const fresh = db.prepare('SELECT status, version FROM inventory_floor_revisions WHERE id = ?')
      .get(loaded.revision.id) as { status: string; version: number } | undefined;
    if (!fresh || fresh.status !== 'draft') { stillDraft = false; return; }
    for (const u of updates) {
      updateCandidate(Number(u.id), {
        disposition: u.disposition !== undefined ? String(u.disposition) : undefined,
        ignored_reason: u.ignored_reason !== undefined ? (u.ignored_reason == null ? null : String(u.ignored_reason).slice(0, 120)) : undefined,
        linked_location_id: u.linked_location_id !== undefined ? (u.linked_location_id == null ? null : Number(u.linked_location_id)) : undefined,
        proposed_kind: u.proposed_kind !== undefined ? String(u.proposed_kind) : undefined,
        proposed_type: u.proposed_type !== undefined ? (u.proposed_type == null ? null : String(u.proposed_type).slice(0, 40)) : undefined,
        proposed_room: u.proposed_room !== undefined ? (u.proposed_room == null ? null : String(u.proposed_room).slice(0, 120)) : undefined,
        polygon: u.polygon !== undefined ? u.polygon : undefined,
      });
    }
    newVersion = fresh.version + 1;
    db.prepare('UPDATE inventory_floor_revisions SET version = ? WHERE id = ?').run(newVersion, loaded.revision.id);
  })();
  if (!stillDraft) {
    return NextResponse.json({ error: 'This plan version was published while you reviewed — reload' }, { status: 409 });
  }
  return NextResponse.json({ message: 'Review saved', updated: updates.length, version: newVersion });
}

export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplan-revisions/[id]/publish
 * POST — publish a reviewed draft (manage). One transaction; see publish.ts.
 */
import { NextResponse } from 'next/server';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import { initFloorplanTables, getRevision, getFloor } from '@/lib/inventory-floorplan/db';
import { publishRevision } from '@/lib/inventory-floorplan/publish';

const HTTP_BY_CODE: Record<string, number> = {
  not_found: 404,
  not_draft: 409,
  conflict: 409,
  bad_coords: 400,
  company_mismatch: 400,
  duplicate_codes: 409,
  unknown_room: 400,
  floor_archived: 409,
};

const MESSAGE_BY_CODE: Record<string, string> = {
  not_found: 'Revision not found',
  not_draft: 'This plan version was already published',
  conflict: 'Someone else just changed this review — reload and try again',
  bad_coords: 'A label has an invalid position',
  company_mismatch: 'A linked spot belongs to another restaurant',
  duplicate_codes: 'Duplicate codes in one room',
  unknown_room: 'A label points at a room that does not exist',
  floor_archived: 'This floor was archived — restore it before publishing',
};

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const id = parseInt(params.id, 10);
  const revision = Number.isFinite(id) && id > 0 ? getRevision(id) : null;
  const floor = revision ? getFloor(revision.floor_id) : null;
  if (!revision || !floor || !canAccessCompany(authz.user, floor.company_id)) {
    return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const version = Number(body?.version);
  if (!Number.isFinite(version) || version <= 0) {
    return NextResponse.json({ error: 'The review version is missing — reload and try again' }, { status: 400 });
  }

  const result = publishRevision(revision.id, { userId: authz.actor.userId, name: authz.actor.name }, version);
  if (!result.ok) {
    return NextResponse.json(
      { error: MESSAGE_BY_CODE[result.code] ?? 'Publish failed', code: result.code, detail: result.detail ?? null },
      { status: HTTP_BY_CODE[result.code] ?? 400 },
    );
  }
  return NextResponse.json(result);
}

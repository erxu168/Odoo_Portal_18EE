export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplans/assets/[revisionId]/[kind]   kind: raster | pdf
 *
 * Authenticated, company-scoped file serving for plan assets. Nothing under
 * data/uploads is ever exposed by path from the client: the revision row is
 * the only source of the relpath, and it must match the server-generated
 * naming scheme (no traversal, ever).
 */
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { initFloorplanTables, getRevision, getFloor } from '@/lib/inventory-floorplan/db';
import { getDb } from '@/lib/db';
import { moduleForbidden } from '@/lib/module-access';

const RELPATH_RE = /^floorplans\/[a-z0-9_.-]+$/i;

export async function GET(_request: Request, { params }: { params: { revisionId: string; kind: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const authz = authorizeFloorplan(FLOORPLAN_CAP.view);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const id = parseInt(params.revisionId, 10);
  const revision = Number.isFinite(id) && id > 0 ? getRevision(id) : null;
  const floor = revision ? getFloor(revision.floor_id) : null;
  if (!revision || !floor || !canAccessCompany(authz.user, floor.company_id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Staff (view cap) see only the LIVE plan. Drafts, superseded versions and
  // their PDFs are review material — manage-only (Codex finding #1).
  const isCurrentPublished = revision.status === 'published' && floor.current_revision_id === revision.id && floor.active;
  if (!isCurrentPublished && !roleCan(authz.actor.role as never, FLOORPLAN_CAP.manage, getPermissionOverrides())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let relpath: string;
  let contentType: string;
  let downloadName: string | null = null;
  if (params.kind === 'raster') {
    relpath = revision.raster_relpath;
    contentType = revision.raster_mime === 'image/png' ? 'image/png' : 'image/webp';
  } else if (params.kind === 'pdf') {
    const doc = getDb().prepare('SELECT pdf_relpath, original_filename FROM inventory_floor_documents WHERE id = ?')
      .get(revision.document_id) as { pdf_relpath: string; original_filename: string } | undefined;
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    relpath = doc.pdf_relpath;
    contentType = 'application/pdf';
    downloadName = doc.original_filename;
  } else {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!RELPATH_RE.test(relpath)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const root = process.env.PORTAL_UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
  const abs = path.join(root, relpath);
  if (!fs.existsSync(abs)) return NextResponse.json({ error: 'File missing on server' }, { status: 404 });

  const buf = fs.readFileSync(abs);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
      ...(downloadName ? { 'Content-Disposition': `inline; filename="${downloadName.replace(/[^\w .-]/g, '_')}"` } : {}),
    },
  });
}

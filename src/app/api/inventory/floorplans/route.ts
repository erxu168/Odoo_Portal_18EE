export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplans
 * GET  — floors of the scoped restaurant, with their current published revision (view)
 * POST — create a floor slot (manage)
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany, writeCompany } from '@/lib/inventory-floorplan/access';
import { initFloorplanTables, createFloor, listFloors, getRevision } from '@/lib/inventory-floorplan/db';

function scopedCompanyFromRequest(request: Request, user: Parameters<typeof canAccessCompany>[0]): number | null {
  const { searchParams } = new URL(request.url);
  const requested = parseInt(searchParams.get('company_id') || '0', 10) || null;
  if (requested && !canAccessCompany(user, requested)) return null;
  const cookieCompany = parseInt(cookies().get('kw_company_id')?.value || '0', 10) || null;
  const fallback = cookieCompany && canAccessCompany(user, cookieCompany) ? cookieCompany : null;
  return writeCompany(user, requested ?? fallback);
}

export async function GET(request: Request) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.view);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const companyId = scopedCompanyFromRequest(request, authz.user);
  if (!companyId) return NextResponse.json({ floors: [] });

  const floors = listFloors([companyId]).map(f => {
    const rev = f.current_revision_id ? getRevision(f.current_revision_id) : null;
    return {
      id: f.id, name: f.name, code: f.code, sort_order: f.sort_order, company_id: f.company_id,
      revision: rev && rev.status === 'published'
        ? {
            id: rev.id, revision_no: rev.revision_no,
            raster_width: rev.raster_width, raster_height: rev.raster_height,
            raster_url: `/api/inventory/floorplans/assets/${rev.id}/raster`,
            published_at: rev.published_at,
          }
        : null,
    };
  });
  return NextResponse.json({ floors, company_id: companyId });
}

export async function POST(request: Request) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const body = await request.json().catch(() => null);
  if (!body || !body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: 'A floor name is required (e.g. "Basement")' }, { status: 400 });
  }
  const requested = body.company_id != null ? Number(body.company_id) : null;
  if (requested && !canAccessCompany(authz.user, requested)) {
    return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
  }
  const companyId = writeCompany(authz.user, requested);
  if (!companyId) return NextResponse.json({ error: 'No restaurant available' }, { status: 400 });

  try {
    const id = createFloor({
      company_id: companyId,
      name: String(body.name),
      code: body.code != null ? String(body.code).slice(0, 8) : '',
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      created_by: authz.actor.userId,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return NextResponse.json({ error: 'A floor with that name already exists here' }, { status: 409 });
    }
    throw e;
  }
}

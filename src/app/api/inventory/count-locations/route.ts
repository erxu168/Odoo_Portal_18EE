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
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds } from '@/lib/db';
import {
  initInventoryTables, createCountLocation, updateCountLocation,
  deleteCountLocation, listCountLocations, getCountLocation,
} from '@/lib/inventory-db';

const KEY = 'inventory.location.manage';

// An empty allowed list means "all companies" (e.g. an admin) — matches the
// semantics of src/app/api/inventory/locations/route.ts.
function allows(allowed: number[], companyId: number): boolean {
  return allowed.length === 0 || allowed.includes(companyId);
}

function resolveCompany(allowed: number[], requested: number | null): number | null {
  if (requested && allows(allowed, requested)) return requested;
  return allowed.length > 0 ? allowed[0] : (requested || null);
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const allowed = parseCompanyIds(user.allowed_company_ids);
  const { searchParams } = new URL(request.url);
  const companyId = resolveCompany(allowed, parseInt(searchParams.get('company_id') || '0', 10) || null);
  if (!companyId) return NextResponse.json({ locations: [] });
  return NextResponse.json({ locations: listCountLocations(companyId) });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden — manager role required' }, { status: 403 });
  initInventoryTables();

  const allowed = parseCompanyIds(user.allowed_company_ids);
  const body = await request.json();
  const companyId = resolveCompany(allowed, body.company_id ?? null);
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
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (!loc || !allows(allowed, loc.company_id))
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
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (!loc || !allows(allowed, loc.company_id))
    return NextResponse.json({ error: 'Location not found' }, { status: 404 });

  deleteCountLocation(id, loc.company_id);
  return NextResponse.json({ message: 'Location removed' });
}

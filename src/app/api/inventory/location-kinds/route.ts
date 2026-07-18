export const dynamic = 'force-dynamic';
/**
 * /api/inventory/location-kinds
 * GET    — list a company's location types (seeds the six defaults on first use)
 * POST   — add a type (manager/admin)          body: { company_id?, label }
 * DELETE — remove a type (manager/admin)       ?id= — refused while in use
 *
 * The type list feeds the "Type" dropdown in the Locations setup screen.
 * count_locations.kind stays free text, so deleting a type never breaks
 * existing locations — deletion is simply blocked while any active location
 * of the company still uses it.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds } from '@/lib/db';
import { initInventoryTables, listLocationKinds, addLocationKind, deleteLocationKind } from '@/lib/inventory-db';

const KEY = 'inventory.location.manage';

// Same company semantics as count-locations: empty allowed list = all companies.
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
  if (!companyId) return NextResponse.json({ kinds: [] });
  return NextResponse.json({ kinds: listLocationKinds(companyId) });
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

  const label = String(body.label || '').trim();
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (label.length > 40) return NextResponse.json({ error: 'Keep the type under 40 characters' }, { status: 400 });

  // Ensure the defaults exist before adding, so a brand-new company doesn't
  // end up with a lone custom type and no familiar ones.
  listLocationKinds(companyId);

  const row = addLocationKind(companyId, label, user.id);
  if (!row) return NextResponse.json({ error: `“${label}” already exists` }, { status: 409 });
  return NextResponse.json({ kind: row }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  initInventoryTables();

  const allowed = parseCompanyIds(user.allowed_company_ids);
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') || '0', 10);
  const companyId = resolveCompany(allowed, parseInt(searchParams.get('company_id') || '0', 10) || null);
  if (!id || !companyId) return NextResponse.json({ error: 'id and company_id are required' }, { status: 400 });

  const result = deleteLocationKind(id, companyId);
  if (!result.ok && result.in_use > 0) {
    return NextResponse.json({
      error: `Still used by ${result.in_use} location${result.in_use !== 1 ? 's' : ''} — change those first`,
      in_use: result.in_use,
    }, { status: 409 });
  }
  if (!result.ok) return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  return NextResponse.json({ message: 'Type removed' });
}

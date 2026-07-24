export const dynamic = 'force-dynamic';
/**
 * /api/inventory/location-kinds — a company's CUSTOM location types only.
 * The built-in types (src/lib/location-types.ts) are the always-available base
 * and live in code; this endpoint manages the extra types a manager adds, each
 * with its own emoji icon.
 *
 * GET    — list a company's custom types (empty until the manager adds one)
 * POST   — add a type (manager/admin)     body: { company_id?, label, icon? }
 * PATCH  — rename a type (manager/admin)   body: { id, company_id?, label, icon? }
 * DELETE — remove a type (manager/admin)  ?id= — refused while in use
 *
 * The type list feeds the "Type" dropdown in the Locations setup screen.
 * count_locations.kind stays free text, so deleting a type never breaks
 * existing locations — deletion is simply blocked while any active location
 * of the company still uses it.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { initInventoryTables, listLocationKinds, addLocationKind, deleteLocationKind, renameLocationKind } from '@/lib/inventory-db';
import { canAccessCompany, resolveScopedCompany } from '@/lib/inventory-access';

const KEY = 'inventory.location.manage';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const requested = parseInt(searchParams.get('company_id') || '0', 10) || null;
  if (requested && !canAccessCompany(user, requested))
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const companyId = resolveScopedCompany(user, requested);
  if (!companyId) return NextResponse.json({ kinds: [] });
  return NextResponse.json({ kinds: listLocationKinds(companyId) });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden — manager role required' }, { status: 403 });
  initInventoryTables();

  const body = await request.json();
  const requested = body.company_id != null ? Number(body.company_id) : null;
  if (requested && !canAccessCompany(user, requested))
    return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
  const companyId = resolveScopedCompany(user, requested);
  if (!companyId) return NextResponse.json({ error: 'No company available' }, { status: 400 });

  const label = String(body.label || '').trim();
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (label.length > 40) return NextResponse.json({ error: 'Keep the type under 40 characters' }, { status: 400 });

  // Optional emoji icon (1–8 chars when supplied). Blank → the DB layer defaults
  // it to '📍'. Built-ins live in code, so we never seed the table here.
  const icon = body.icon != null ? String(body.icon).trim() : '';
  if (icon && icon.length > 8) return NextResponse.json({ error: 'Pick a single emoji for the icon' }, { status: 400 });

  const row = addLocationKind(companyId, label, icon, user.id);
  if (!row) return NextResponse.json({ error: `“${label}” already exists` }, { status: 409 });
  return NextResponse.json({ kind: row }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  initInventoryTables();

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const requested = body.company_id != null ? Number(body.company_id) : null;
  if (requested && !canAccessCompany(user, requested))
    return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
  const companyId = resolveScopedCompany(user, requested);
  const label = String(body.label || '').trim();
  if (!id || !companyId) return NextResponse.json({ error: 'id and company_id are required' }, { status: 400 });
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (label.length > 40) return NextResponse.json({ error: 'Keep the type under 40 characters' }, { status: 400 });

  // Optional emoji icon (1–8 chars when supplied); blank falls back to '📍'.
  const icon = body.icon != null ? String(body.icon).trim() : '';
  if (icon && icon.length > 8) return NextResponse.json({ error: 'Pick a single emoji for the icon' }, { status: 400 });

  const result = renameLocationKind(id, companyId, label, icon);
  if (!result.ok && result.dupe) return NextResponse.json({ error: `“${label}” already exists` }, { status: 409 });
  if (!result.ok) return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  return NextResponse.json({ message: 'Type renamed' });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') || '0', 10);
  const requested = parseInt(searchParams.get('company_id') || '0', 10) || null;
  if (requested && !canAccessCompany(user, requested))
    return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
  const companyId = resolveScopedCompany(user, requested);
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

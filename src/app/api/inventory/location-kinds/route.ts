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
import { initInventoryTables, listLocationKinds, addLocationKind, deleteLocationKind, renameLocationKind } from '@/lib/inventory-db';
import { setLocationKindColor, setLocationKindShape, setLocationKindLayer, upsertLocationKind } from '@/lib/inventory-floorplan/db';
import { isMarkerShape as isShape } from '@/lib/inventory-floorplan/marker-presets';
import { authorizeFloorplan, FLOORPLAN_CAP } from '@/lib/inventory-floorplan/access';
import { canAccessCompany, resolveScopedCompany } from '@/lib/inventory-access';

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
  // Same guard as the rest of the floorplan/locations family: module gate +
  // resolved shared-tablet actor, so writes are attributed to the person.
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const user = authz.user;
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

  // Optional marker color for the floorplan (hex like #16A34A).
  const color = body.color != null ? String(body.color).trim() : '';
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
    return NextResponse.json({ error: 'The color must look like #16A34A' }, { status: 400 });
  }

  const shape = isShape(body.shape) ? body.shape : null;
  const layer = [1, 2, 3, 4].includes(Number(body.layer)) ? Number(body.layer) : null;

  const row = addLocationKind(companyId, label, icon, authz.actor.userId);
  if (!row) return NextResponse.json({ error: `“${label}” already exists` }, { status: 409 });
  if (color) setLocationKindColor(row.id, companyId, color);
  if (shape) setLocationKindShape(row.id, companyId, shape);
  if (layer) setLocationKindLayer(row.id, companyId, layer);
  return NextResponse.json({ kind: { ...row, color: color || null, shape: shape ?? 'dot', layer: layer ?? 3 } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const user = authz.user;
  initInventoryTables();

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const requested = body.company_id != null ? Number(body.company_id) : null;
  if (requested && !canAccessCompany(user, requested))
    return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
  const companyId = resolveScopedCompany(user, requested);
  const label = String(body.label || '').trim();
  if ((!id && !body.kind) || !companyId) return NextResponse.json({ error: 'id or kind is required' }, { status: 400 });
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (label.length > 40) return NextResponse.json({ error: 'Keep the type under 40 characters' }, { status: 400 });

  // Optional emoji icon (1–8 chars when supplied); blank falls back to '📍'.
  const icon = body.icon != null ? String(body.icon).trim() : '';
  if (icon && icon.length > 8) return NextResponse.json({ error: 'Pick a single emoji for the icon' }, { status: 400 });

  const color = body.color !== undefined ? (body.color == null ? null : String(body.color).trim()) : undefined;
  if (color != null && color !== '' && !/^#[0-9a-f]{6}$/i.test(color)) {
    return NextResponse.json({ error: 'The color must look like #16A34A' }, { status: 400 });
  }

  // Editing a BUILT-IN type: it has no row yet, so upsert an override keyed by
  // its kind. Everything on screen must be editable (Ethan's rule).
  if (!id && typeof body.kind === 'string' && body.kind.trim()) {
    upsertLocationKind(companyId, String(body.kind).trim(), {
      label, icon: icon || undefined,
      color: color === undefined ? undefined : (color || null),
      shape: isShape(body.shape) ? body.shape : undefined,
      layer: [1, 2, 3, 4].includes(Number(body.layer)) ? Number(body.layer) : undefined,
      hidden: body.hidden === true ? 1 : body.hidden === false ? 0 : undefined,
      createdBy: authz.actor.userId,
    });
    return NextResponse.json({ message: 'Type updated' });
  }

  const result = renameLocationKind(id, companyId, label, icon);
  if (!result.ok && result.dupe) return NextResponse.json({ error: `“${label}” already exists` }, { status: 409 });
  if (!result.ok) return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  if (color !== undefined) setLocationKindColor(id, companyId, color || null);
  if (isShape(body.shape)) setLocationKindShape(id, companyId, body.shape);
  if ([1, 2, 3, 4].includes(Number(body.layer))) setLocationKindLayer(id, companyId, Number(body.layer));
  if (body.hidden === true || body.hidden === false) {
    upsertLocationKind(companyId, String(body.kind ?? '').trim() || label.toLowerCase(), { hidden: body.hidden ? 1 : 0 });
  }
  return NextResponse.json({ message: 'Type renamed' });
}

export async function DELETE(request: Request) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const user = authz.user;
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') || '0', 10);
  const requested = parseInt(searchParams.get('company_id') || '0', 10) || null;
  if (requested && !canAccessCompany(user, requested))
    return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
  const companyId = resolveScopedCompany(user, requested);
  if ((!id && !searchParams.get('kind')) || !companyId) return NextResponse.json({ error: 'id or kind is required' }, { status: 400 });

  const kindParam = (searchParams.get('kind') || '').trim();
  if (!id && kindParam) {
    // Built-in: cannot be deleted (locations reference the key) — hide it from
    // this restaurant's library instead. Reversible from the Hidden list.
    upsertLocationKind(companyId, kindParam, { hidden: 1, createdBy: authz.actor.userId });
    return NextResponse.json({ message: 'Removed from your library' });
  }

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

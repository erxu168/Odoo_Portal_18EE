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
import { setLocationKindColor, setLocationKindShape, setLocationKindLayer, setLocationKindMarkerOnly, upsertLocationKind, markerConversionBlockers, getLocationKindRow } from '@/lib/inventory-floorplan/db';
import { isMarkerShape as isShape } from '@/lib/inventory-floorplan/marker-presets';
import { authorizeFloorplan, FLOORPLAN_CAP } from '@/lib/inventory-floorplan/access';
import { canAccessCompany, resolveScopedCompany } from '@/lib/inventory-access';
import { moduleForbidden } from '@/lib/module-access';


/**
 * Turning a type into a MARKER hides every location of that type from the
 * product picker. If any of them already holds products or contains other
 * places, that would hide real records — and the next save from a product
 * sheet would write the reduced set. So the switch refuses, and says why.
 */
function markerConversionRefusal(companyId: number, kind: string): string | null {
  const b = markerConversionBlockers(companyId, kind);
  if (b.products === 0 && b.children === 0) return null;
  const parts: string[] = [];
  if (b.products) parts.push(`${b.products} product${b.products === 1 ? '' : 's'} stored there`);
  if (b.children) parts.push(`${b.children} place${b.children === 1 ? '' : 's'} inside`);
  return `Not yet — ${b.locations} location${b.locations === 1 ? '' : 's'} of this type still ${b.products + b.children === 1 ? 'has' : 'have'} ${parts.join(' and ')}. Move those first, then make it a marker.`;
}

export async function GET(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

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
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

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
  // Marker-only: the type marks a thing (valve, fuse box) rather than holding
  // products. Nothing nests inside it and it stays out of the product picker.
  const markerOnly = body.markerOnly === true;

  const row = addLocationKind(companyId, label, icon, authz.actor.userId);
  if (!row) return NextResponse.json({ error: `“${label}” already exists` }, { status: 409 });
  if (color) setLocationKindColor(row.id, companyId, color);
  if (shape) setLocationKindShape(row.id, companyId, shape);
  if (layer) setLocationKindLayer(row.id, companyId, layer);
  if (markerOnly) setLocationKindMarkerOnly(row.id, companyId, true);
  return NextResponse.json({ kind: { ...row, color: color || null, shape: shape ?? 'dot', layer: layer ?? 3, marker_only: markerOnly ? 1 : 0 } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

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
    if (body.markerOnly === true) {
      const refusal = markerConversionRefusal(companyId, String(body.kind).trim());
      if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });
    }
    upsertLocationKind(companyId, String(body.kind).trim(), {
      label, icon: icon || undefined,
      color: color === undefined ? undefined : (color || null),
      shape: isShape(body.shape) ? body.shape : undefined,
      layer: [1, 2, 3, 4].includes(Number(body.layer)) ? Number(body.layer) : undefined,
      hidden: body.hidden === true ? 1 : body.hidden === false ? 0 : undefined,
      markerOnly: body.markerOnly === true ? 1 : body.markerOnly === false ? 0 : undefined,
      createdBy: authz.actor.userId,
    });
    return NextResponse.json({ message: 'Type updated' });
  }

  // PREFLIGHT before anything is written: the row itself says which kind this
  // is (never the client — a stale or wrong `kind` would check the blockers of
  // some other type), and a refusal must not land after a half-applied edit.
  const row = getLocationKindRow(id, companyId);
  if (!row) return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  const wantsMarker = body.markerOnly === true || body.markerOnly === false ? body.markerOnly : null;
  const becomingMarker = wantsMarker === true && row.marker_only !== 1;
  if (becomingMarker) {
    const refusal = markerConversionRefusal(companyId, row.kind);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });
  }

  const result = renameLocationKind(id, companyId, label, icon);
  if (!result.ok && result.dupe) return NextResponse.json({ error: `“${label}” already exists` }, { status: 409 });
  if (!result.ok) return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  if (color !== undefined) setLocationKindColor(id, companyId, color || null);
  if (isShape(body.shape)) setLocationKindShape(id, companyId, body.shape);
  if ([1, 2, 3, 4].includes(Number(body.layer))) setLocationKindLayer(id, companyId, Number(body.layer));
  if (wantsMarker !== null) setLocationKindMarkerOnly(id, companyId, wantsMarker);
  if (body.hidden === true || body.hidden === false) {
    upsertLocationKind(companyId, row.kind, { hidden: body.hidden ? 1 : 0 });
  }
  return NextResponse.json({ message: 'Type renamed' });
}

export async function DELETE(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

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

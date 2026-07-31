export const dynamic = 'force-dynamic';
/**
 * /api/inventory/waste — the Waste Tracker: binned RAW stock, the third term of
 * the consumption equation (opening + purchases − waste − closing = used).
 *
 * GET    — everything the entry screen needs in one call: recently-binned
 *          product ids, today's entries (no photo blobs), and whether THIS
 *          department requires a photo
 * POST   — record an entry (base quantity computed server-side, like receipts;
 *          idempotent on client_key so a flaky-wifi retry can't bin twice)
 * PATCH  — annotate an entry that is ALREADY saved (reason / note / photo — the
 *          mock's "or just walk away": the quantity committed at the numpad)
 * DELETE — Undo (?id=): a SOFT delete, idempotent, bounded to the caller
 *
 * Attribution is NEVER taken from the request: on a shared department tablet
 * the entry is credited to the PIN-signed person (shift-attribution), and the
 * department comes from that person's HR record — the same chain the task list
 * uses. If Odoo can't say which department, the entry still saves without one:
 * the business record is the quantity; losing it to a hiccup is the real
 * corruption, and the photo rule is deliberately fail-open for the same reason.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { parseCompanyIds, getPermissionOverrides, getUserById, type PortalUser } from '@/lib/db';
import { roleCan } from '@/lib/permissions';
import {
  initInventoryTables, recordWaste, voidWaste, annotateWaste, getWasteEvent,
  listWaste, recentlyWastedProducts, isWastePhotoRequired, listCountLocations,
  type WasteEvent,
} from '@/lib/inventory-db';
import { isUnrestrictedAdmin, canAccessCompany } from '@/lib/inventory-access';
import { crateTotal } from '@/lib/crate-units';
import { resolveAttribution } from '@/lib/shift-attribution';
import { getEmployeeContext } from '@/lib/odoo-tasks';
import { berlinToday } from '@/lib/berlin-date';
import { berlinMidnightMs } from '@/lib/waj-sales-time';

function activeCompany(searchParams: URLSearchParams): number {
  return parseInt(searchParams.get('company_id') || '0', 10)
    || parseInt(cookies().get('kw_company_id')?.value || '0', 10);
}

/** The PIN-signed person and their department. Department is best-effort. */
async function actorContext(user: PortalUser): Promise<{ userId: number; departmentId: number | null; noActor: boolean }> {
  const { userId, employeeId } = resolveAttribution(user);
  // On a shared tablet, "resolved to the tablet account itself" means nobody is
  // signed in — there is no human to credit.
  const noActor = !!user.is_shared_device && userId === user.id;
  let departmentId: number | null = null;
  if (employeeId) {
    try {
      const ctx = await getEmployeeContext(employeeId);
      departmentId = ctx?.department_id ?? null;
    } catch {
      console.warn('[inventory] waste: could not resolve department — recording without one');
    }
  }
  return { userId, departmentId, noActor };
}

/** Photo blobs never travel in lists — the day list only says whether one exists. */
function slim(e: WasteEvent, names: Record<number, string>) {
  const { photo, ...rest } = e;
  return { ...rest, has_photo: !!photo, wasted_by_name: names[e.wasted_by] || '' };
}

function nameMap(events: WasteEvent[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const id of Array.from(new Set(events.map((e) => e.wasted_by)))) {
    out[id] = getUserById(id)?.name || '';
  }
  return out;
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const company = activeCompany(searchParams);
  if (!company || !(isUnrestrictedAdmin(user) || canAccessCompany(user, company))) {
    return NextResponse.json({ error: 'Pick a restaurant you can access' }, { status: 400 });
  }

  const { departmentId } = await actorContext(user);
  // The department's own recent history first; a department that has never
  // binned anything yet borrows the whole restaurant's, so the grid is never
  // uselessly empty on day one.
  let recent = recentlyWastedProducts(company, 8, departmentId);
  if (recent.length === 0 && departmentId) recent = recentlyWastedProducts(company, 8);

  const dayStart = new Date(berlinMidnightMs(berlinToday())).toISOString();
  const today = listWaste(company, { from: dayStart, limit: 100 });
  const names = nameMap(today);

  return NextResponse.json({
    recent,
    today: today.map((e) => slim(e, names)),
    photo_required: departmentId ? isWastePhotoRequired(departmentId) : false,
    department_id: departmentId,
  });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.waste.record', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  initInventoryTables();

  const body = await request.json();
  const { product_id, count_location_id, crate_qty, loose_qty, units_per_crate, qty, uom, reason, note, photo, client_key } = body;
  const { searchParams } = new URL(request.url);
  const company = body.company_id != null ? Number(body.company_id) : activeCompany(searchParams);
  if (!company || !(isUnrestrictedAdmin(user) || canAccessCompany(user, company))) {
    return NextResponse.json({ error: 'Pick a restaurant you can access' }, { status: 400 });
  }
  if (!product_id || !Number.isInteger(Number(product_id)) || Number(product_id) <= 0) {
    return NextResponse.json({ error: 'product_id required' }, { status: 400 });
  }

  const { userId, departmentId, noActor } = await actorContext(user);
  if (noActor) {
    return NextResponse.json({
      error: 'Sign in with your PIN first, so the entry is credited to you.',
      code: 'NO_ACTOR',
    }, { status: 409 });
  }

  // Base total computed HERE, exactly like receipts: a pack split converts;
  // otherwise the plain quantity is used.
  const hasSplit = units_per_crate != null && Number(units_per_crate) > 0 && (crate_qty !== undefined || loose_qty !== undefined);
  const qtyBase = hasSplit
    ? crateTotal(Number(crate_qty) || 0, Number(loose_qty) || 0, Number(units_per_crate))
    : Number(qty);
  if (!Number.isFinite(qtyBase) || qtyBase <= 0 || qtyBase > 1e7) {
    return NextResponse.json({ error: 'Enter a valid amount' }, { status: 400 });
  }
  let locId = Number.isInteger(count_location_id) && count_location_id >= 0 ? count_location_id : 0;
  if (locId !== 0 && !listCountLocations(company).some((l) => l.id === locId)) locId = 0;

  // Optional photo: raster only + size-capped (no SVG/XSS, no huge blobs).
  let photoVal: string | null = null;
  if (typeof photo === 'string' && photo) {
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(photo) || photo.length > 8_000_000) {
      return NextResponse.json({ error: 'Photo must be a small PNG/JPEG/WebP image' }, { status: 400 });
    }
    photoVal = photo;
  }

  // The per-department rule, enforced where it can't be dodged. Only when the
  // department is KNOWN — an Odoo hiccup must never cost the entry itself.
  if (departmentId && isWastePhotoRequired(departmentId) && !photoVal) {
    return NextResponse.json({
      error: 'Your department requires a photo with every waste entry.',
      code: 'PHOTO_REQUIRED',
    }, { status: 400 });
  }

  const id = recordWaste({
    companyId: company,
    departmentId,
    productId: Number(product_id),
    locationId: locId,
    qtyBase,
    crateQty: hasSplit ? (Number(crate_qty) || 0) : null,
    looseQty: hasSplit ? (Number(loose_qty) || 0) : null,
    unitsPerCrate: hasSplit ? Number(units_per_crate) : null,
    uom: typeof uom === 'string' && uom ? uom.slice(0, 40) : 'Units',
    reason: reason ? String(reason).slice(0, 120) : null,
    note: note ? String(note).slice(0, 500) : null,
    photo: photoVal,
    userId,
    clientKey: typeof client_key === 'string' && client_key ? client_key.slice(0, 80) : null,
  });

  const event = getWasteEvent(id);
  const names = event ? nameMap([event]) : {};
  return NextResponse.json({ id, event: event ? slim(event, names) : null, message: 'Binned' }, { status: 201 });
}

/**
 * Whether this caller may touch this entry: managers anywhere in their
 * restaurants, everyone else only what is credited to them.
 */
function mayTouch(user: PortalUser, userId: number, event: WasteEvent): boolean {
  if (!isUnrestrictedAdmin(user)) {
    const allowed = parseCompanyIds(user.allowed_company_ids);
    if (!allowed.includes(event.company_id)) return false;
  }
  const isManager = roleCan(user.role, 'inventory.review.approve', getPermissionOverrides());
  return isManager || event.wasted_by === userId;
}

export async function PATCH(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const body = await request.json();
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const event = getWasteEvent(id);
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Attribution only — the department is already on the entry, no Odoo call.
  const { userId } = resolveAttribution(user);
  if (!mayTouch(user, userId, event)) {
    return NextResponse.json({ error: 'Not yours to change' }, { status: 403 });
  }

  const patch: { reason?: string | null; note?: string | null; photo?: string | null } = {};
  if (body.reason !== undefined) patch.reason = body.reason ? String(body.reason).slice(0, 120) : null;
  if (body.note !== undefined) patch.note = body.note ? String(body.note).slice(0, 500) : null;
  if (body.photo !== undefined) {
    if (typeof body.photo === 'string' && body.photo) {
      if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(body.photo) || body.photo.length > 8_000_000) {
        return NextResponse.json({ error: 'Photo must be a small PNG/JPEG/WebP image' }, { status: 400 });
      }
      patch.photo = body.photo;
    } else {
      // Stripping the photo where the department demands one would quietly
      // defeat the manager's switch.
      if (event.department_id && isWastePhotoRequired(event.department_id)) {
        return NextResponse.json({ error: 'Your department requires a photo on every entry.' }, { status: 400 });
      }
      patch.photo = null;
    }
  }
  const ok = annotateWaste(id, patch);
  if (!ok) return NextResponse.json({ error: 'Nothing to change, or the entry was undone' }, { status: 409 });
  return NextResponse.json({ message: 'Saved' });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') || '0', 10);
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const event = getWasteEvent(id);
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { userId } = resolveAttribution(user);
  if (!mayTouch(user, userId, event)) {
    return NextResponse.json({ error: 'Not yours to undo' }, { status: 403 });
  }

  // Two Undo taps must both succeed from the user's side: the second is simply
  // already done.
  if (!voidWaste(id, userId) && !event.voided_at) {
    return NextResponse.json({ error: 'Could not undo' }, { status: 500 });
  }
  return NextResponse.json({ message: 'Undone' });
}

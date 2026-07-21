export const dynamic = 'force-dynamic';
/**
 * /api/inventory/counts
 *
 * GET  — get entries for a session
 * POST — upsert a count entry (save from numpad/stepper)
 * DELETE — remove a count entry
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initInventoryTables, upsertCountEntry, deleteCountEntry, getSessionEntries, getSession, getTemplate, setCountPhotos, getCountPhotosMap, getSessionItems, getSessionLocations } from '@/lib/inventory-db';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { canAccessSession } from '@/lib/inventory-access';
import { getOdoo } from '@/lib/odoo';
import { resolveAttribution } from '@/lib/shift-attribution';
import { crateTotal } from '@/lib/crate-units';
import { inventoryOdooSyncEnabled } from '@/lib/inventory-config';

// A count line can only be written/removed while the session is still open.
function isEditable(status: string): boolean {
  return status === 'pending' || status === 'in_progress';
}


export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const session = getSession(parseInt(sessionId));
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!canAccessSession(user, session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const entries = getSessionEntries(parseInt(sessionId));
  const photoMap = getCountPhotosMap('count_entries', entries.map((e: any) => e.id));
  const hydrated = entries.map((e: any) => ({ ...e, photos: photoMap[e.id] || [] }));

  // The frozen snapshot: one line per (product, spot) + the frozen spot names.
  // Empty for legacy sessions → the client renders the flat product list.
  const items = getSessionItems(parseInt(sessionId));
  const spots = getSessionLocations(parseInt(sessionId));

  // System quantities (Odoo stock.quant variance) only when Odoo sync is on.
  // Off by default: the portal count is the source of truth, no comparison to an
  // unconfigured Odoo stock number.
  const systemQtys: Record<number, number> = {};
  if (inventoryOdooSyncEnabled()) try {
    const odoo = getOdoo();
    // Scope to this session's list products and sum ALL quants (including negative
    // dimensional rows), rather than only positive quants across the whole location.
    const tmpl = getTemplate(session.template_id);
    const pids: number[] = Array.isArray(tmpl?.product_ids) ? (tmpl!.product_ids as number[]) : [];
    const domain: any[] = pids.length > 0
      ? [['location_id', '=', session.location_id], ['product_id', 'in', pids]]
      : [['location_id', '=', session.location_id]];
    const quants = await odoo.searchRead('stock.quant', domain, ['product_id', 'quantity'], { limit: 5000 });
    for (const q of quants) {
      if (q.product_id) {
        const pid = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
        systemQtys[pid] = (systemQtys[pid] || 0) + q.quantity;
      }
    }
  } catch (e) {
    console.error('Failed to fetch system quantities from Odoo:', e);
  }

  return NextResponse.json({ entries: hydrated, system_qtys: systemQtys, items, spots });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const body = await request.json();
  const { session_id, product_id, count_location_id, out_of_stock, counted_qty, crate_qty, loose_qty, units_per_crate, system_qty, uom, notes, photos } = body;

  // Which spot this count is for (0 = no specific spot / legacy client).
  // Validated against the session's frozen snapshot further below.
  let locId = Number.isInteger(count_location_id) && count_location_id >= 0 ? count_location_id : 0;
  // Explicit "none here" — recorded distinctly from a counted 0 or an uncounted row.
  const isOut = out_of_stock === true;

  // When a crate split is provided, the base total is computed HERE (server is
  // the source of truth) so the value written to Odoo can never drift. Odoo
  // still only ever receives the base-unit total via counted_qty. Out of stock
  // is a deliberate zero.
  const hasSplit = !isOut && units_per_crate != null && Number(units_per_crate) > 0
    && (crate_qty !== undefined || loose_qty !== undefined);
  const baseQty = isOut ? 0 : (hasSplit
    ? crateTotal(Number(crate_qty) || 0, Number(loose_qty) || 0, Number(units_per_crate))
    : counted_qty);

  if (!session_id || !product_id || baseQty === undefined || baseQty === null) {
    return NextResponse.json({ error: 'session_id, product_id, counted_qty required' }, { status: 400 });
  }

  const session = getSession(session_id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!canAccessSession(user, session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Editable while open. A SUBMITTED count additionally accepts single-line
  // corrections from a reviewer (manager fixes one absurd number instead of
  // rejecting the whole count) — attributed to the manager and noted.
  const isReviewerCorrection = session.status === 'submitted'
    && roleCan(user.role, 'inventory.review.approve', getPermissionOverrides());
  if (!isEditable(session.status) && !isReviewerCorrection) {
    return NextResponse.json({ error: 'This count can no longer be edited' }, { status: 400 });
  }

  // Untrusted client input: the quantity must be a sane finite non-negative number,
  // and the line must be one this session actually counts — its total gets written
  // to stock on approval, so an arbitrary product/spot/qty must never get in.
  if (!Number.isFinite(baseQty) || baseQty < 0 || baseQty > 1e7) {
    return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 });
  }
  const snapshot = getSessionItems(session_id);
  if (snapshot.length > 0) {
    // Modern session: the (product, spot) pair must be an exact frozen line.
    if (!snapshot.some((it) => it.odoo_product_id === Number(product_id) && it.count_location_id === locId)) {
      return NextResponse.json({ error: 'That item/spot is not on this count' }, { status: 400 });
    }
  } else {
    // Legacy session: spot-less counting only, validated against the template.
    locId = 0;
    const tmpl = getTemplate(session.template_id);
    const listIds: number[] = Array.isArray(tmpl?.product_ids) ? (tmpl!.product_ids as number[]) : [];
    if (listIds.length > 0 && !listIds.includes(Number(product_id))) {
      return NextResponse.json({ error: 'That product is not on this count list' }, { status: 400 });
    }
  }

  upsertCountEntry({
    session_id, product_id, counted_qty: baseQty,
    count_location_id: locId,
    out_of_stock: isOut,
    system_qty: system_qty ?? null,
    uom: uom || 'Units',
    notes: isReviewerCorrection ? `Manager correction${notes ? `: ${notes}` : ''}` : notes,
    counted_by: resolveAttribution(user).userId,
    // undefined (not null) when no split → upsertCountEntry preserves any
    // existing crate split (e.g. a later photo-only save of a crate product).
    crate_qty: hasSplit ? (Number(crate_qty) || 0) : undefined,
    loose_qty: hasSplit ? (Number(loose_qty) || 0) : undefined,
    units_per_crate: hasSplit ? Number(units_per_crate) : undefined,
  });

  if (Array.isArray(photos)) {
    const entries = getSessionEntries(session_id);
    // Match the row for THIS spot (same product can exist at several spots).
    const entry = entries.find((e: any) => e.product_id === product_id && (e.count_location_id ?? 0) === locId);
    if (entry) setCountPhotos('count_entries', entry.id, photos);
  }

  return NextResponse.json({ message: 'Count saved' });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  const productId = searchParams.get('product_id');
  const locParam = searchParams.get('count_location_id');
  if (!sessionId || !productId) {
    return NextResponse.json({ error: 'session_id and product_id required' }, { status: 400 });
  }
  // With a spot → remove just that spot's row; without → remove the product from
  // every spot in the session (legacy behaviour).
  const locId = locParam != null && locParam !== '' ? parseInt(locParam) : undefined;

  const session = getSession(parseInt(sessionId));
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!canAccessSession(user, session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isEditable(session.status)) return NextResponse.json({ error: 'This count can no longer be edited' }, { status: 400 });

  // Modern (snapshotted) sessions delete ONE line — the spot is required so a
  // clear at one spot can never wipe the product's other spots. Legacy keeps
  // the old delete-everywhere behavior for spot-less clients.
  const modern = getSessionItems(parseInt(sessionId)).length > 0;
  if (modern && !Number.isFinite(locId)) {
    return NextResponse.json({ error: 'count_location_id required' }, { status: 400 });
  }
  deleteCountEntry(parseInt(sessionId), parseInt(productId), Number.isFinite(locId) ? locId : undefined);
  return NextResponse.json({ message: 'Count removed' });
}

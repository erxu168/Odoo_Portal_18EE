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
import { initInventoryTables, upsertCountEntry, deleteCountEntry, getSessionEntries, getSession, getTemplate, setCountPhotos, getCountPhotosMap, getSessionItems, getSessionLocations, updateSessionStatus, getSessionLocationStatuses, setSessionLocationStatus } from '@/lib/inventory-db';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { canAccessSession } from '@/lib/inventory-access';
import { getOdoo } from '@/lib/odoo';
import { allowedProductIds } from '@/lib/inventory-scope';
import { getProductFlags, getSessionPackagingLevels, listPackagingLevelsFor } from '@/lib/inventory-db';
import { resolveAttribution } from '@/lib/shift-attribution';
import { crateTotal } from '@/lib/crate-units';
import { packTotal, usableLevels } from '@/lib/packaging';
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

  // Opening a pending count claims it as IN PROGRESS — so "apply layout to
  // today" can never regenerate a session a device (possibly offline by now)
  // has already opened.
  if (session.status === 'pending') {
    // Guarded on 'pending' inside the UPDATE: the status was read a moment ago,
    // and without it a count submitted in between would be quietly reopened.
    try { updateSessionStatus(parseInt(sessionId), 'in_progress', { fromStatus: 'pending' }); }
    catch { /* status is advisory here */ }
  }

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

  // The packaging chain AS FROZEN for this session, per product. The count
  // screen must convert with the chain the count was STARTED with, never the
  // product's current one — otherwise editing a box size re-prices a count that
  // is already under way.
  const packaging: Record<number, { id: number; name: string; toBase: number; countable: boolean; allowPartial: boolean }[]> = {};
  const frozen = getSessionPackagingLevels(parseInt(sessionId));
  frozen.forEach((levels, pid) => {
    packaging[pid] = levels.map((l) => (
      { id: l.id, name: l.name, toBase: l.toBase, countable: l.countable, allowPartial: l.allowPartial }
    ));
  });
  // CATEGORY-only lists resolve their products from Odoo at count time, so there
  // is nothing to freeze at creation and the snapshot is empty for them. Fall
  // back to the product's LIVE chain rather than leaving those counts with no
  // packaging at all — the same live-config behaviour those lists already have
  // for units/flags. Product-list sessions keep their frozen chain untouched.
  if (items.length === 0) {
    const t = getTemplate(session.template_id);
    const pids: number[] = Array.isArray(t?.product_ids) ? (t!.product_ids as number[]) : [];
    const live = listPackagingLevelsFor(pids.length > 0 ? pids : Object.keys(systemQtys).map(Number));
    live.forEach((levels, pid) => {
      if (packaging[pid]) return;
      packaging[pid] = levels.map((l) => (
        { id: l.id, name: l.name, toBase: l.to_base, countable: l.countable === 1, allowPartial: l.allow_partial === 1 }
      ));
    });
  }

  return NextResponse.json({ entries: hydrated, system_qtys: systemQtys, items, spots, packaging });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const body = await request.json();
  const { session_id, product_id, count_location_id, out_of_stock, counted_qty, crate_qty, loose_qty, units_per_crate, system_qty, uom, notes, photos, pack_counts } = body;

  // Which spot this count is for (0 = no specific spot / legacy client).
  // Validated against the session's frozen snapshot further below.
  let locId = Number.isInteger(count_location_id) && count_location_id >= 0 ? count_location_id : 0;
  // Explicit "none here" — recorded distinctly from a counted 0 or an uncounted row.
  const isOut = out_of_stock === true;

  const sentSplit = !isOut && (crate_qty !== undefined || loose_qty !== undefined);

  if (!session_id || !product_id) {
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

  // The line must be one this session actually counts — its total gets written
  // to stock on approval, so an arbitrary product/spot must never get in.
  const snapshot = getSessionItems(session_id);
  if (snapshot.length > 0) {
    // Modern session: the (product, spot) pair must be an exact frozen line.
    if (!snapshot.some((it) => it.odoo_product_id === Number(product_id) && it.count_location_id === locId)) {
      return NextResponse.json({ error: 'That item/spot is not on this count' }, { status: 400 });
    }
  } else {
    // Legacy session: spot-less counting only, validated against the template.
    // A CATEGORY-only list used to skip this check entirely (its explicit
    // product list is empty), which let any product id be written into someone
    // else's count. The scope helper resolves those categories.
    locId = 0;
    const scope = await allowedProductIds(session);
    if (scope.kind === 'known' && !scope.ids.has(Number(product_id))) {
      return NextResponse.json({ error: 'That product is not on this count list' }, { status: 400 });
    }
    // scope 'unknown' means Odoo could not be asked. A stray line is visible to
    // the manager and costs nothing until approval, which refuses to guess — so
    // let the person in front of the shelf keep counting.
  }

  // How many base units are in one pack. This must come from the SERVER: the
  // request used to supply its own multiplier and the total was computed from
  // it, so "1 crate" with units_per_crate 9999999 stored 9,999,999 — and the
  // review screen showed the approver "1 crate". The session's frozen value
  // wins, because a pack size edited mid-count must not rescale a saved line;
  // a legacy count with nothing frozen falls back to the product's setting.
  let packSize: number | null = null;
  if (snapshot.length > 0) {
    const line = snapshot.find(
      (it) => it.odoo_product_id === Number(product_id) && it.count_location_id === locId,
    );
    packSize = line?.units_per_crate ?? null;
  }
  if (packSize == null) {
    const f = getProductFlags([Number(product_id)])[0];
    packSize = f?.units_per_crate ?? null;
  }
  // A NESTED chain (box -> pack -> piece) beats the single pack size when the
  // session froze one. Same rule as above and for the same reason: the level
  // values come from the FROZEN chain, never from the request, so no caller can
  // decide what a box is worth. What arrived is only "how many at each level".
  const frozenChain = getSessionPackagingLevels(session_id).get(Number(product_id)) || [];
  const chain = usableLevels(frozenChain);
  const sentLevels = pack_counts && typeof pack_counts === 'object';
  const hasChain = chain.length > 0 && sentLevels;

  const hasSplit = !hasChain && sentSplit && packSize != null && packSize > 0;
  const baseQty = isOut ? 0 : (
    hasChain
      ? packTotal({ byLevel: pack_counts as Record<number, number>, loose: Number(loose_qty) || 0 }, chain)
      : hasSplit
        ? crateTotal(Number(crate_qty) || 0, Number(loose_qty) || 0, packSize as number)
        : counted_qty);

  // A per-level count sent for a product with no chain on THIS count means the
  // two sides disagree about what the product is; storing the numbers as if
  // they were base units would invent stock.
  if (sentLevels && !hasChain) {
    return NextResponse.json({ error: 'This product is not counted in nested packs on this list' }, { status: 400 });
  }

  if (baseQty === undefined || baseQty === null) {
    return NextResponse.json({ error: 'session_id, product_id, counted_qty required' }, { status: 400 });
  }
  // Untrusted client input: the quantity must be a sane finite non-negative number.
  if (!Number.isFinite(baseQty) || baseQty < 0 || baseQty > 1e7) {
    return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 });
  }
  // A split was sent for a product that has no pack size on this count — the
  // client and the server disagree about what this product IS, so refuse rather
  // than silently storing the crate figure as if it were base units.
  if (sentSplit && !hasSplit) {
    return NextResponse.json({ error: 'This product is not counted in packs on this list' }, { status: 400 });
  }

  // A reviewer correction FIXES an existing line — on a legacy session (no
  // snapshot to validate against) it must never introduce a new product row.
  if (isReviewerCorrection && snapshot.length === 0) {
    const exists = getSessionEntries(session_id).some(
      (e: any) => e.product_id === Number(product_id) && (e.count_location_id ?? 0) === locId,
    );
    if (!exists) return NextResponse.json({ error: 'Corrections can only change lines that were counted' }, { status: 400 });
  }

  upsertCountEntry({
    session_id, product_id, counted_qty: baseQty,
    count_location_id: locId,
    out_of_stock: isOut,
    system_qty: system_qty ?? null,
    uom: uom || 'Units',
    // Staff notes and manager corrections live in different columns, so a
    // reviewer fixing a number can never erase what the counter wrote.
    notes: isReviewerCorrection ? undefined : notes,
    manager_note: isReviewerCorrection ? (notes ? `Manager correction: ${notes}` : 'Manager correction') : undefined,
    counted_by: resolveAttribution(user).userId,
    // undefined (not null) when no split → upsertCountEntry preserves any
    // existing crate split (e.g. a later photo-only save of a crate product).
    // A plain-number manager correction CLEARS any stale crate/loose audit
    // split (the correction is a base-quantity statement); normal saves without
    // a split keep preserving an existing one (undefined).
    crate_qty: hasSplit ? (Number(crate_qty) || 0) : (isReviewerCorrection ? null : undefined),
    loose_qty: hasSplit ? (Number(loose_qty) || 0) : (isReviewerCorrection ? null : undefined),
    units_per_crate: hasSplit ? (packSize as number) : (isReviewerCorrection ? null : undefined),
    // How the counter got there, kept beside the total they got to.
    pack_counts: hasChain ? JSON.stringify(pack_counts) : (isReviewerCorrection ? null : undefined),
  });

  // Counting something HERE means this place was not skipped after all. Clear
  // the stale skip so the manager doesn't read "skipped: ran out of time" on a
  // shelf that has real numbers on it. (Staff can still skip it again.) A
  // manager correcting an already-submitted count must NOT rewrite what the
  // counter recorded about the walk, so reviewers are excluded.
  if (!isReviewerCorrection) {
    try {
      const st = getSessionLocationStatuses(session_id).find((x: any) => x.count_location_id === locId);
      if (st && st.status === 'skipped') setSessionLocationStatus(session_id, locId, 'pending', null);
    } catch { /* status bookkeeping must never fail a saved count */ }
  }

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

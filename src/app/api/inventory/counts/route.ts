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
import { initInventoryTables, upsertCountEntry, deleteCountEntry, getSessionEntries, getSession, getTemplate, setCountPhotos, getCountPhotosMap } from '@/lib/inventory-db';
import { canAccessSession } from '@/lib/inventory-access';
import { getOdoo } from '@/lib/odoo';
import { resolveAttribution } from '@/lib/shift-attribution';
import { crateTotal } from '@/lib/crate-units';

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

  // Fetch system quantities from Odoo stock.quant for this session's list products.
  const systemQtys: Record<number, number> = {};
  try {
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

  return NextResponse.json({ entries: hydrated, system_qtys: systemQtys });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const body = await request.json();
  const { session_id, product_id, counted_qty, crate_qty, loose_qty, units_per_crate, system_qty, uom, notes, photos } = body;

  // When a crate split is provided, the base total is computed HERE (server is
  // the source of truth) so the value written to Odoo can never drift. Odoo
  // still only ever receives the base-unit total via counted_qty.
  const hasSplit = units_per_crate != null && Number(units_per_crate) > 0
    && (crate_qty !== undefined || loose_qty !== undefined);
  const baseQty = hasSplit
    ? crateTotal(Number(crate_qty) || 0, Number(loose_qty) || 0, Number(units_per_crate))
    : counted_qty;

  if (!session_id || !product_id || baseQty === undefined || baseQty === null) {
    return NextResponse.json({ error: 'session_id, product_id, counted_qty required' }, { status: 400 });
  }

  const session = getSession(session_id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!canAccessSession(user, session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isEditable(session.status)) return NextResponse.json({ error: 'This count can no longer be edited' }, { status: 400 });

  // Untrusted client input: the quantity must be a sane finite non-negative number,
  // and the product must actually be on this session's list — its counts get written
  // to Odoo stock on approval, so an arbitrary product/qty must never get in.
  if (!Number.isFinite(baseQty) || baseQty < 0 || baseQty > 1e7) {
    return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 });
  }
  const tmpl = getTemplate(session.template_id);
  // getTemplate already returns product_ids as a parsed number[] (see parseTemplate).
  const listIds: number[] = Array.isArray(tmpl?.product_ids) ? (tmpl!.product_ids as number[]) : [];
  if (listIds.length > 0 && !listIds.includes(Number(product_id))) {
    return NextResponse.json({ error: 'That product is not on this count list' }, { status: 400 });
  }

  upsertCountEntry({
    session_id, product_id, counted_qty: baseQty,
    system_qty: system_qty ?? null,
    uom: uom || 'Units',
    notes,
    counted_by: resolveAttribution(user).userId,
    // undefined (not null) when no split → upsertCountEntry preserves any
    // existing crate split (e.g. a later photo-only save of a crate product).
    crate_qty: hasSplit ? (Number(crate_qty) || 0) : undefined,
    loose_qty: hasSplit ? (Number(loose_qty) || 0) : undefined,
    units_per_crate: hasSplit ? Number(units_per_crate) : undefined,
  });

  if (Array.isArray(photos)) {
    const entries = getSessionEntries(session_id);
    const entry = entries.find((e: any) => e.product_id === product_id);
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
  if (!sessionId || !productId) {
    return NextResponse.json({ error: 'session_id and product_id required' }, { status: 400 });
  }

  const session = getSession(parseInt(sessionId));
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!canAccessSession(user, session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isEditable(session.status)) return NextResponse.json({ error: 'This count can no longer be edited' }, { status: 400 });

  deleteCountEntry(parseInt(sessionId), parseInt(productId));
  return NextResponse.json({ message: 'Count removed' });
}

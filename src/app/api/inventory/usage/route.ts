export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/usage?opening_session=&closing_session=
 *
 * Portal-native consumption report:
 *   consumption = opening count + received (between the two counts) − closing count
 * per product. No Odoo. Guarded by session access; both counts must be the same
 * restaurant.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { initInventoryTables, getSession, getSessionEntries, sumReceiptsByProduct } from '@/lib/inventory-db';
import { canAccessSession } from '@/lib/inventory-access';
import { berlinMidnightMs } from '@/lib/waj-sales-time';
import { isCanonicalDay } from '@/lib/berlin-date';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.consumption.view', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const openingId = parseInt(searchParams.get('opening_session') || '0', 10);
  const closingId = parseInt(searchParams.get('closing_session') || '0', 10);
  if (!openingId || !closingId) {
    return NextResponse.json({ error: 'opening_session and closing_session required' }, { status: 400 });
  }

  const opening = getSession(openingId);
  const closing = getSession(closingId);
  if (!opening || !closing) return NextResponse.json({ error: 'Count not found' }, { status: 404 });
  if (!canAccessSession(user, opening) || !canAccessSession(user, closing)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if ((opening.company_id ?? null) !== (closing.company_id ?? null)) {
    return NextResponse.json({ error: 'Both counts must belong to the same restaurant' }, { status: 400 });
  }
  if (openingId === closingId) {
    return NextResponse.json({ error: 'Pick two different counts' }, { status: 400 });
  }
  // Must be opening + closing of the SAME list, so the products line up.
  if (opening.template_id !== closing.template_id) {
    return NextResponse.json({ error: 'Both counts must be of the same list' }, { status: 400 });
  }
  // Ordered by the count DAY (scheduled_date) — the same key the UI pairs
  // counts by. Deliberately NOT by activity timestamps: a backfilled count can
  // be submitted out of order, which must not reject a valid date-ordered pair.
  const openDate = opening.scheduled_date || String(opening.created_at).slice(0, 10);
  const closeDate = closing.scheduled_date || String(closing.created_at).slice(0, 10);
  // Defensive: a malformed or impossible legacy date would mis-order
  // lexicographically, roll into another month, or blow up the Berlin-day
  // conversion — reject it instead.
  if (!isCanonicalDay(openDate) || !isCanonicalDay(closeDate)) {
    return NextResponse.json({ error: 'One of these counts has no valid date' }, { status: 400 });
  }
  if (openDate > closeDate) {
    return NextResponse.json({ error: 'The opening count must be on or before the closing count' }, { status: 400 });
  }

  // Each product's base-unit total in a session (summed across spots).
  function totals(sessionId: number): Record<number, number> {
    const out: Record<number, number> = {};
    for (const e of getSessionEntries(sessionId)) {
      out[e.product_id] = (out[e.product_id] || 0) + (Number(e.counted_qty) || 0);
    }
    return out;
  }
  const openTotals = totals(openingId);
  const closeTotals = totals(closingId);

  // Received window = strictly AFTER the opening count, up to the closing count,
  // so a delivery already reflected in the opening stock isn't counted twice.
  // Each boundary is the count's real finish time when it has one; an
  // unfinished count falls back to the END of its scheduled BERLIN day — the
  // business day is Europe/Berlin, not UTC (DST-correct via the shared
  // sales-time helper). Deliveries logged during the closing day still count
  // while that count is in progress; opening-day deliveries before an
  // unfinished opening are conservatively excluded.
  const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const berlinDayStart = (d: string) => new Date(berlinMidnightMs(d)).toISOString();
  const berlinDayEnd = (d: string) => new Date(berlinMidnightMs(nextDay(d)) - 1).toISOString();
  let openBoundary = opening.submitted_at || berlinDayEnd(openDate);
  let closeBoundary = closing.submitted_at || berlinDayEnd(closeDate);
  if (openDate === closeDate && (!opening.submitted_at || !closing.submitted_at || openBoundary > closeBoundary)) {
    // Legacy same-day duplicate (the unique index blocks new ones) without a
    // trustworthy intraday order → EMPTY window: that day's deliveries are
    // ambiguous and must never be double-counted.
    openBoundary = closeBoundary = berlinDayEnd(closeDate);
  } else if (openBoundary > closeBoundary) {
    // Out-of-order backfill across days: finish times are meaningless for
    // windowing — fall back to whole-day boundaries.
    openBoundary = berlinDayStart(openDate);
    closeBoundary = berlinDayEnd(closeDate);
  }
  const companyIds = opening.company_id != null ? [opening.company_id] : null;
  const received = sumReceiptsByProduct(companyIds, openBoundary, closeBoundary);

  const productIds = Array.from(new Set<number>([
    ...Object.keys(openTotals).map(Number),
    ...Object.keys(closeTotals).map(Number),
    ...Object.keys(received).map(Number),
  ]));

  const rows = productIds.map((pid) => {
    const inOpen = pid in openTotals;
    const inClose = pid in closeTotals;
    const opening_qty = openTotals[pid] || 0;
    const closing_qty = closeTotals[pid] || 0;
    const received_qty = received[pid] || 0;
    const complete = inOpen && inClose;
    return {
      product_id: pid,
      opening_qty,
      received_qty,
      closing_qty,
      // Only computable when the product was counted at BOTH endpoints — else we
      // flag it rather than guess.
      consumption: complete ? opening_qty + received_qty - closing_qty : null,
      complete,
      missing: complete ? null : (!inOpen ? 'opening' : 'closing'),
    };
  });

  return NextResponse.json({
    from: openBoundary,
    to: closeBoundary,
    opening_date: opening.scheduled_date,
    closing_date: closing.scheduled_date,
    rows,
  });
}

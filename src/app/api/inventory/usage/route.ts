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
import { initInventoryTables, getSession, getSessionEntries, sumReceiptsByProduct } from '@/lib/inventory-db';
import { canAccessSession } from '@/lib/inventory-access';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  // Received window = the opening day 00:00 → the closing day 23:59 (inclusive).
  const fromDate = (opening.scheduled_date || String(opening.created_at).slice(0, 10)) + 'T00:00:00.000Z';
  const toDate = (closing.scheduled_date || String(closing.created_at).slice(0, 10)) + 'T23:59:59.999Z';
  const companyIds = opening.company_id != null ? [opening.company_id] : null;
  const received = sumReceiptsByProduct(companyIds, fromDate, toDate);

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
    from: fromDate,
    to: toDate,
    opening_date: opening.scheduled_date,
    closing_date: closing.scheduled_date,
    rows,
  });
}

/**
 * /api/inventory/counts
 *
 * GET  — get entries for a session
 * POST — upsert a count entry (save from numpad/stepper)
 * DELETE — remove a count entry
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initInventoryTables, upsertCountEntry, deleteCountEntry, getSessionEntries, getSession } from '@/lib/inventory-db';
import { getOdoo } from '@/lib/odoo';

initInventoryTables();

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const entries = getSessionEntries(parseInt(sessionId));

  // Fetch system quantities from Odoo stock.quant for this session's location
  let systemQtys: Record<number, number> = {};
  try {
    const session = getSession(parseInt(sessionId));
    if (session) {
      const odoo = getOdoo();
      const quants = await odoo.searchRead('stock.quant',
        [['location_id', '=', session.location_id], ['quantity', '>', 0]],
        ['product_id', 'quantity'],
        { limit: 1000 },
      );
      for (const q of quants) {
        if (q.product_id) {
          const pid = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
          systemQtys[pid] = (systemQtys[pid] || 0) + q.quantity;
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch system quantities from Odoo:', e);
  }

  return NextResponse.json({ entries, system_qtys: systemQtys });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { session_id, product_id, counted_qty, system_qty, uom, notes } = body;

  if (!session_id || !product_id || counted_qty === undefined) {
    return NextResponse.json({ error: 'session_id, product_id, counted_qty required' }, { status: 400 });
  }

  upsertCountEntry({
    session_id, product_id, counted_qty,
    system_qty: system_qty ?? null,
    uom: uom || 'Units',
    notes,
    counted_by: user.id,
  });

  return NextResponse.json({ message: 'Count saved' });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  const productId = searchParams.get('product_id');
  if (!sessionId || !productId) {
    return NextResponse.json({ error: 'session_id and product_id required' }, { status: 400 });
  }

  deleteCountEntry(parseInt(sessionId), parseInt(productId));
  return NextResponse.json({ message: 'Count removed' });
}

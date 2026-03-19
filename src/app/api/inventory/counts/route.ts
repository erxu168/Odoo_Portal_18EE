/**
 * /api/inventory/counts
 *
 * GET  — get entries for a session
 * POST — upsert a count entry (save from numpad/stepper)
 * DELETE — remove a count entry
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initInventoryTables, upsertCountEntry, deleteCountEntry, getSessionEntries } from '@/lib/inventory-db';

initInventoryTables();

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const entries = getSessionEntries(parseInt(sessionId));
  return NextResponse.json({ entries });
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

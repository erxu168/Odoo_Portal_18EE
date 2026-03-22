/**
 * /api/inventory/quick-count
 *
 * GET  — list quick counts (filter by status)
 *        Accepts 'submitted' as alias for 'pending' (for consistency with session statuses)
 * POST — submit a batch of quick counts
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, createQuickCount, listQuickCounts, approveQuickCount } from '@/lib/inventory-db';

initInventoryTables();

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  let status = searchParams.get('status') || undefined;

  // Map 'submitted' to 'pending' for quick counts (sessions use 'submitted', quick counts use 'pending')
  if (status === 'submitted') status = 'pending';

  // Staff sees their own, manager/admin sees all
  const filters: any = { status };
  if (!hasRole(user, 'manager')) {
    filters.counted_by = user.id;
  }

  const counts = listQuickCounts(filters);
  return NextResponse.json({ counts });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { entries, location_id } = body;

  if (!entries || !Array.isArray(entries) || !location_id) {
    return NextResponse.json({ error: 'entries array and location_id required' }, { status: 400 });
  }

  const ids: number[] = [];
  for (const entry of entries) {
    const id = createQuickCount({
      product_id: entry.product_id,
      location_id,
      counted_qty: entry.counted_qty,
      uom: entry.uom || 'Units',
      counted_by: user.id,
    });
    ids.push(id);
  }

  return NextResponse.json({ ids, message: `${ids.length} quick counts submitted` }, { status: 201 });
}

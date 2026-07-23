export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/pack-labels/merge  { from_id, into_id }
 * Move every product counted in the `from` unit onto `into`, then remove `from`.
 * GLOBAL list → admin only (same as the other pack-label writes).
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { initInventoryTables, mergePackLabels } from '@/lib/inventory-db';

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'admin')) {
    return NextResponse.json({ error: 'Only an admin can change count-by units — they are shared across all restaurants' }, { status: 403 });
  }
  initInventoryTables();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const fromId = Number((body as { from_id?: unknown }).from_id);
  const intoId = Number((body as { into_id?: unknown }).into_id);
  if (!Number.isInteger(fromId) || fromId <= 0 || !Number.isInteger(intoId) || intoId <= 0) {
    return NextResponse.json({ error: 'from_id and into_id are required' }, { status: 400 });
  }

  const res = mergePackLabels(fromId, intoId);
  if (!res.ok && res.error === 'same') return NextResponse.json({ error: 'Pick a different unit to move into' }, { status: 400 });
  if (!res.ok) return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
  return NextResponse.json({ message: 'Units merged', moved: res.moved });
}

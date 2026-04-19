export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/product-flags
 *
 * Returns the set of product flags used by the inventory counting flow
 * (currently just requires_photo). All authenticated users can read —
 * staff needs to know which products require a photo when counting.
 *
 * Query: ?ids=1,2,3 to fetch a subset (otherwise returns all).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initInventoryTables, getProductFlags } from '@/lib/inventory-db';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get('ids');
  let ids: number[] | undefined;
  if (idsParam) {
    ids = idsParam.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
  }

  const flags = getProductFlags(ids);
  return NextResponse.json({ flags });
}

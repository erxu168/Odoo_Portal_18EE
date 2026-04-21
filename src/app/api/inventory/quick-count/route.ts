export const dynamic = 'force-dynamic';
/**
 * /api/inventory/quick-count
 *
 * GET  — list quick counts (filter by status)
 *        Accepts 'submitted' as alias for 'pending' (for consistency with session statuses)
 * POST — submit a batch of quick counts
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, createQuickCount, listQuickCounts, approveQuickCount, getProductFlags, setCountPhotos, getCountPhotosMap } from '@/lib/inventory-db';


export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  let status = searchParams.get('status') || undefined;

  // Map 'submitted' to 'pending' for quick counts
  if (status === 'submitted') status = 'pending';

  const filters: any = { status };
  if (!hasRole(user, 'manager')) {
    filters.counted_by = user.id;
  }

  const counts = listQuickCounts(filters);
  const photoMap = getCountPhotosMap('quick_counts', counts.map((c: any) => c.id));
  const hydrated = counts.map((c: any) => ({ ...c, photos: photoMap[c.id] || [] }));
  return NextResponse.json({ counts: hydrated });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const body = await request.json();
  const { entries, location_id } = body;

  if (!entries || !Array.isArray(entries) || !location_id) {
    return NextResponse.json({ error: 'entries array and location_id required' }, { status: 400 });
  }

  // Load flags for the set of products in this submission
  const productIds: number[] = entries.map((e: any) => Number(e.product_id)).filter(Boolean);
  const flagRows = getProductFlags(productIds);
  const flagMap: Record<number, boolean> = {};
  flagRows.forEach(f => { flagMap[f.odoo_product_id] = !!f.requires_photo; });

  // Server-side validation: flagged + qty>0 must have at least one photo
  for (const entry of entries) {
    const pid = Number(entry.product_id);
    const qty = Number(entry.counted_qty);
    const photos: string[] = Array.isArray(entry.photos) ? entry.photos : [];
    if (flagMap[pid] && qty > 0 && photos.length === 0) {
      return NextResponse.json({
        error: `Product ${pid} requires a photo when counting`,
      }, { status: 400 });
    }
  }

  const ids: number[] = [];
  for (const entry of entries) {
    const id = createQuickCount({
      product_id: Number(entry.product_id),
      location_id,
      counted_qty: Number(entry.counted_qty),
      uom: entry.uom || 'Units',
      counted_by: user.id,
    });
    const photos: string[] = Array.isArray(entry.photos) ? entry.photos : [];
    if (photos.length > 0) {
      setCountPhotos('quick_counts', id, photos);
    }
    ids.push(id);
  }

  return NextResponse.json({ ids, message: `${ids.length} quick counts submitted` }, { status: 201 });
}

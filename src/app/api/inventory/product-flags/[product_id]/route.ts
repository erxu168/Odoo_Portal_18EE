export const dynamic = 'force-dynamic';
/**
 * PUT /api/inventory/product-flags/[product_id]
 *
 * Upserts a product flag. Manager+ only.
 * Body: { requires_photo: boolean }
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, setProductFlag } from '@/lib/inventory-db';

export async function PUT(
  request: Request,
  { params }: { params: { product_id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.product_id, 10);
  if (isNaN(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    initInventoryTables();
    const body = await request.json();
    const requiresPhoto = !!body.requires_photo;
    setProductFlag(productId, requiresPhoto, user.id);
    return NextResponse.json({ success: true, requires_photo: requiresPhoto });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[product-flags PUT]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
/**
 * PUT /api/inventory/product-flags/[product_id]
 *
 * Upserts a product flag. Manager+ only.
 * Body: { requires_photo?: boolean, units_per_crate?: number | null, pack_label?: string | null }
 * Only the keys present in the body are changed. Pass units_per_crate = null
 * (or 0) to clear the pack size so the product is counted in base units.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { initInventoryTables, setProductFlag, setProductCrateSize, setProductPackLabel } from '@/lib/inventory-db';

export async function PUT(
  request: Request,
  { params }: { params: { product_id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.product_id, 10);
  if (isNaN(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    initInventoryTables();
    const body = await request.json();
    const result: { success: true; requires_photo?: boolean; units_per_crate?: number | null; pack_label?: string | null } = { success: true };

    if ('requires_photo' in body) {
      const requiresPhoto = !!body.requires_photo;
      setProductFlag(productId, requiresPhoto, user.id);
      result.requires_photo = requiresPhoto;
    }

    if ('units_per_crate' in body) {
      const raw = body.units_per_crate;
      let size: number | null;
      if (raw === null || raw === '' || raw === undefined) {
        size = null;
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100000) {
          return NextResponse.json({ error: 'Invalid crate size' }, { status: 400 });
        }
        size = n > 0 ? n : null;
      }
      setProductCrateSize(productId, size, user.id);
      result.units_per_crate = size;
    }

    if ('pack_label' in body) {
      const raw = body.pack_label;
      const label = (raw == null || String(raw).trim() === '') ? null : String(raw).trim().toLowerCase().slice(0, 20);
      setProductPackLabel(productId, label, user.id);
      result.pack_label = label;
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[product-flags PUT]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
/**
 * /api/inventory/product-images/[product_id]
 *
 * GET    — the product's picture as a raw image (for <img src=...>). 404 if none.
 * PUT    — set it (JSON { image: dataUrl }). Manager+.
 * DELETE — clear it. Manager+.
 *
 * Portal-owned product pictures (camera or upload). Stored as a base64 data URL.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { initInventoryTables, getProductImage, setProductImage, deleteProductImage } from '@/lib/inventory-db';

function pid(params: { product_id: string }): number {
  return parseInt(params.product_id, 10);
}

export async function GET(_request: Request, { params }: { params: { product_id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();
  const productId = pid(params);
  if (!Number.isFinite(productId) || productId <= 0) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });

  const img = getProductImage(productId);
  if (!img) return NextResponse.json({ error: 'No image' }, { status: 404 });

  // Stored as a data URL — decode to raw bytes so it works as an <img> source and
  // the browser can cache it.
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(img.image);
  if (m) {
    const buf = Buffer.from(m[2], 'base64');
    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=300' },
    });
  }
  // Not a data URL (shouldn't happen) — hand back what we have.
  return NextResponse.json({ image: img.image, mime: img.mime });
}

export async function PUT(request: Request, { params }: { params: { product_id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  initInventoryTables();
  const productId = pid(params);
  if (!Number.isFinite(productId) || productId <= 0) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });

  const body = await request.json();
  const image = body.image;
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return NextResponse.json({ error: 'image (data URL) required' }, { status: 400 });
  }
  // Cap size (~6 MB decoded). Clients should downscale before upload.
  if (image.length > 8_000_000) {
    return NextResponse.json({ error: 'Image too large — please use a smaller photo' }, { status: 400 });
  }
  const mime = /^data:([^;]+);/.exec(image)?.[1] ?? null;
  setProductImage(productId, image, mime, user.id);
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: { product_id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  initInventoryTables();
  const productId = pid(params);
  if (!Number.isFinite(productId) || productId <= 0) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  deleteProductImage(productId);
  return NextResponse.json({ success: true });
}

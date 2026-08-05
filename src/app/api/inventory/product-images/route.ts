export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/product-images
 * Returns { with_images: number[] } — product ids that have a picture, so a
 * picker/count list renders a thumbnail only where one exists (no 404 spam).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initInventoryTables, listProductImageIds } from '@/lib/inventory-db';
import { moduleForbidden } from '@/lib/module-access';

export async function GET() {
  const denied = moduleForbidden(['inventory', 'products']);
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();
  return NextResponse.json({ with_images: listProductImageIds() });
}

export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/pack-labels/products?label=<unit>
 * The products counted in a given count-by unit (name + id), so a manager can
 * see exactly what a merge/delete would affect before doing it.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { initInventoryTables, productIdsUsingPackLabel } from '@/lib/inventory-db';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const label = (new URL(request.url).searchParams.get('label') || '').trim();
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });

  const ids = Array.from(new Set(productIdsUsingPackLabel(label)));
  if (ids.length === 0) return NextResponse.json({ products: [] });

  try {
    const odoo = getOdoo();
    const rows = await odoo.read('product.product', ids, ['id', 'name']);
    const byId = new Map<number, string>((rows as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    // Preserve the flag set even if Odoo dropped an archived/missing id.
    const products = ids.map((id) => ({ id, name: byId.get(id) || `Product #${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ products });
  } catch {
    const products = ids.map((id) => ({ id, name: `Product #${id}` })).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ products });
  }
}

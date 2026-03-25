/**
 * GET /api/products/search?q=butter&limit=10
 * Search product.product in Odoo for ingredient autocomplete.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '15', 10), 50);

    if (q.length < 1) {
      return NextResponse.json({ products: [] });
    }

    const odoo = getOdoo();
    const domain: unknown[] = [['name', 'ilike', q]];

    const products = await odoo.searchRead(
      'product.product', domain,
      ['id', 'name', 'uom_id'],
      { limit, order: 'name' },
    );

    return NextResponse.json({
      products: products.map((p: Record<string, unknown>) => ({
        id: p.id,
        name: p.name,
        uom_id: Array.isArray(p.uom_id) ? p.uom_id[0] : null,
        uom_name: Array.isArray(p.uom_id) ? p.uom_id[1] : '',
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Product search error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

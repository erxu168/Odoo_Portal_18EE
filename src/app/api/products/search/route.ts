import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

/**
 * GET /api/products/search?q=...&limit=20
 * Search products for adding as BOM ingredients.
 * Returns id, name, uom_id, uom_name.
 */
export async function GET(req: NextRequest) {
  try {
    requireAuth();
    const q = req.nextUrl.searchParams.get('q') || '';
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20');
    const odoo = getOdoo();

    const domain: any[] = [['type', '!=', 'service']];
    if (q.length >= 2) {
      domain.push(['name', 'ilike', q]);
    }

    const products = await odoo.searchRead(
      'product.product',
      domain,
      ['id', 'name', 'uom_id', 'categ_id'],
      { limit, order: 'name asc' },
    );

    return NextResponse.json({
      ok: true,
      products: products.map((p: any) => ({
        id: p.id,
        name: p.name,
        uom_id: p.uom_id[0],
        uom_name: p.uom_id[1],
        category: p.categ_id?.[1]?.split(' / ').pop() || 'Other',
      })),
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('GET /api/products/search error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to search products' }, { status: 500 });
  }
}

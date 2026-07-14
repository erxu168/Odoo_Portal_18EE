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
    const q = (req.nextUrl.searchParams.get('q') || '').trim();
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20');
    const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0') || 0;
    const odoo = getOdoo();

    // Empty q -> full product list (browsable by default). A non-empty q filters by name.
    const domain: any[] = [['type', '!=', 'service']];
    if (q.length >= 1) {
      domain.push(['name', 'ilike', q]);
    }

    const products = await odoo.searchRead(
      'product.product',
      domain,
      ['id', 'name', 'uom_id', 'categ_id'],
      { limit, offset, order: 'name asc' },
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

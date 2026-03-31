import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/products/search?q=...&limit=20
 * Search products for adding as BOM ingredients.
 * Returns id, name, uom_id, uom_name.
 */
export async function GET(req: NextRequest) {
  try {
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
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * GET /api/inventory/products
 *
 * Proxies product.product from Odoo 18 EE.
 * Query params: ?category_id=32&search=soju&limit=100
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get('category_id');
  const search = searchParams.get('search');
  const limit = parseInt(searchParams.get('limit') || '200');

  try {
    const odoo = getOdoo();
    const domain: any[] = [['type', '=', 'consu']];
    if (categoryId) domain.push(['categ_id', '=', parseInt(categoryId)]);
    if (search) domain.push(['name', 'ilike', search]);

    const products = await odoo.searchRead('product.product', domain,
      ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode'],
      { limit, order: 'categ_id, name' }
    );

    return NextResponse.json({ products });
  } catch (err: any) {
    console.error('Inventory products error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

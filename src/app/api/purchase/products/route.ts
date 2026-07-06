/**
 * GET /api/purchase/products
 * Search Odoo products for adding to order guides.
 * Params: ?q=search_term&category=Food&limit=30
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const limit = parseInt(searchParams.get('limit') || '40');
  const offset = parseInt(searchParams.get('offset') || '0') || 0;

  try {
    const odoo = getOdoo();

    // Build domain filter
    const domain: any[] = [];
    if (q) {
      domain.push(['name', 'ilike', q]);
    }
    if (category && category !== 'All') {
      domain.push(['categ_id.name', 'ilike', category]);
    }

    const products = await odoo.searchRead('product.product',
      domain,
      ['id', 'name', 'uom_id', 'categ_id', 'list_price', 'type', 'active'],
      { limit, offset, order: 'categ_id, name' }
    );

    // Also fetch categories for filter pills
    const categories = await odoo.searchRead('product.category',
      [['parent_id', '!=', false]],
      ['id', 'name', 'complete_name'],
      { limit: 50, order: 'name' }
    );

    // Common units for the "create new product" form (curated subset of uom.uom).
    const COMMON_UNITS = ['Units', 'kg', 'g', 'mg', 'L', 'ml', 'Dozen', 'lb', 'oz', 't'];
    const uomRows = await odoo.searchRead('uom.uom', [], ['id', 'name'], { limit: 300 });
    const units = (uomRows as any[])
      .filter((u) => COMMON_UNITS.includes(u.name))
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => COMMON_UNITS.indexOf(a.name) - COMMON_UNITS.indexOf(b.name));

    const formatted = (products || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      uom: p.uom_id?.[1] || 'Units',
      category_id: p.categ_id?.[0] || 0,
      category_name: p.categ_id?.[1]?.split(' / ').pop() || 'Other',
      price: p.list_price || 0,
      type: p.type,
    }));

    const categoryList = (categories || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      full_name: c.complete_name,
    }));

    return NextResponse.json({ products: formatted, categories: categoryList, units });
  } catch (e: any) {
    console.error('Failed to search Odoo products:', e);
    return NextResponse.json({ error: e.message || 'Failed to search products', products: [], categories: [] }, { status: 500 });
  }
}

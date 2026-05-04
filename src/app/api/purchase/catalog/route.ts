/**
 * GET /api/purchase/catalog?q=...&location_id=...&limit=100
 * Cross-supplier product search over all order guides at a location.
 * Returns matches grouped by product name, sorted cheapest first within a group.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/lib/db';

interface CatalogRow {
  item_id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  price: number;
  category_name: string;
  supplier_id: number;
  supplier_name: string;
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const locationId = parseInt(searchParams.get('location_id') || '0');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

  if (!locationId) return NextResponse.json({ error: 'location_id required' }, { status: 400 });
  if (q.length < 2) return NextResponse.json({ groups: [], total: 0, message: 'Enter at least 2 characters' });

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT gi.id AS item_id, gi.product_id, gi.product_name, gi.product_uom,
              gi.price, gi.category_name,
              s.id AS supplier_id, s.name AS supplier_name
         FROM purchase_guide_items gi
         JOIN purchase_order_guides g ON g.id = gi.guide_id
         JOIN purchase_suppliers s ON s.id = g.supplier_id
        WHERE s.active = 1
          AND g.location_id = ?
          AND gi.product_name LIKE ?
        ORDER BY gi.product_name COLLATE NOCASE, gi.price ASC
        LIMIT ?`
    )
    .all(locationId, `%${q}%`, limit) as CatalogRow[];

  // Group by product_id so chef sees "Tomatoes, red" once with 3 supplier options beneath
  const byProduct = new Map<number, { product_id: number; product_name: string; product_uom: string; category_name: string; options: CatalogRow[] }>();
  for (const r of rows) {
    const key = r.product_id;
    if (!byProduct.has(key)) {
      byProduct.set(key, {
        product_id: r.product_id,
        product_name: r.product_name,
        product_uom: r.product_uom,
        category_name: r.category_name,
        options: [],
      });
    }
    byProduct.get(key)!.options.push(r);
  }

  // Sort options within each product by price asc; also flag cheapest
  const groups = Array.from(byProduct.values()).map((g) => {
    g.options.sort((a, b) => a.price - b.price);
    return g;
  });

  return NextResponse.json({ groups, total: rows.length });
}

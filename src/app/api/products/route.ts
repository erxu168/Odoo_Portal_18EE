/**
 * POST /api/products — create a new product.product in Odoo.
 * Only managers/admins can create products.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Only managers and admins can create products' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, uom_id } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Check for duplicates
    const existing = await odoo.searchRead(
      'product.product', [['name', '=ilike', name.trim()]],
      ['id', 'name'], { limit: 1 },
    );
    if (existing.length > 0) {
      return NextResponse.json({
        error: `Product "${existing[0].name}" already exists`,
        existing_id: existing[0].id,
      }, { status: 409 });
    }

    const vals: Record<string, unknown> = {
      name: name.trim(),
      type: 'consu',
    };
    if (uom_id) vals.uom_id = uom_id;

    const productId = await odoo.create('product.product', vals);

    // Read back the created product to return full data
    const created = await odoo.read('product.product', [productId], ['id', 'name', 'uom_id']);

    return NextResponse.json({
      product: {
        id: created[0].id,
        name: created[0].name,
        uom_id: Array.isArray(created[0].uom_id) ? created[0].uom_id[0] : null,
        uom_name: Array.isArray(created[0].uom_id) ? created[0].uom_id[1] : '',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Product create error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

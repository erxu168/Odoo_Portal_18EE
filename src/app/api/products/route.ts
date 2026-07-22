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
    const categId = Number(body.categ_id);
    const defaultCode = typeof body.default_code === 'string' ? body.default_code.trim() : '';

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
    if (uom_id) { vals.uom_id = uom_id; vals.uom_po_id = uom_id; }
    if (Number.isInteger(categId) && categId > 0) vals.categ_id = categId;
    if (defaultCode) vals.default_code = defaultCode;

    const productId = await odoo.create('product.product', vals);

    // Read back the created product to return full data (shape matches the
    // inventory products GET so callers can drop it straight into a list).
    const created = await odoo.read('product.product', [productId], ['id', 'name', 'uom_id', 'categ_id', 'default_code', 'barcode']);
    const c = created[0];

    return NextResponse.json({
      product: {
        id: c.id,
        name: c.name,
        // Back-compat: uom_id stays a scalar id (+ uom_name), as the original
        // contract. New fields below are additive.
        uom_id: Array.isArray(c.uom_id) ? c.uom_id[0] : null,
        uom_name: Array.isArray(c.uom_id) ? c.uom_id[1] : '',
        categ_id: c.categ_id || null,                               // [id, name] tuple
        default_code: c.default_code || null,
        barcode: c.barcode || null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Product create error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

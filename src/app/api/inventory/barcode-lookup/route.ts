/**
 * GET  /api/inventory/barcode-lookup?barcode=XXX
 *   Looks up a barcode in product.product then product.packaging.
 *   Returns { found, product?, source } where source is 'product'|'packaging'|'not_found'.
 *
 * POST /api/inventory/barcode-lookup
 *   Assigns a barcode to a product (scan-to-assign). Manager+ only.
 *   Body: { product_id: number, barcode: string }
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { isDraftProduct } from '@/lib/inventory-db';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const barcode = searchParams.get('barcode');
  if (!barcode) return NextResponse.json({ error: 'barcode query param required' }, { status: 400 });

  try {
    const odoo = getOdoo();

    // 1. Direct match on product.product — include inactive drafts,
    //    exclude POS products (we only count raw stock in this module)
    const products = await odoo.searchRead(
      'product.product',
      [
        ['barcode', '=', barcode],
        ['type', '=', 'consu'],
        ['available_in_pos', '=', false],
      ],
      ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active'],
      { limit: 1, context: { active_test: false } },
    );
    if (products.length > 0) {
      const p = products[0];
      return NextResponse.json({
        found: true,
        product: p,
        source: 'product',
        is_draft: p.active === false && isDraftProduct(p.id),
      });
    }

    // 2. Check product.packaging (alternate barcodes) — only match if the
    //    underlying product is non-POS
    const packagings = await odoo.searchRead(
      'product.packaging',
      [['barcode', '=', barcode]],
      ['id', 'name', 'product_id', 'barcode'],
      { limit: 1 },
    );
    if (packagings.length > 0 && packagings[0].product_id) {
      const prodId = packagings[0].product_id[0];
      const prods = await odoo.searchRead(
        'product.product',
        [
          ['id', '=', prodId],
          ['available_in_pos', '=', false],
        ],
        ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active'],
        { limit: 1, context: { active_test: false } },
      );
      if (prods.length > 0) {
        const p = prods[0];
        return NextResponse.json({
          found: true,
          product: p,
          source: 'packaging',
          is_draft: p.active === false && isDraftProduct(p.id),
        });
      }
    }

    return NextResponse.json({ found: false, source: 'not_found' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[barcode-lookup GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Only managers and admins can assign barcodes
  const role = user.role || 'staff';
  if (role === 'staff') {
    return NextResponse.json({ error: 'Only managers can assign barcodes' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { product_id, barcode } = body;
    if (!product_id || !barcode) {
      return NextResponse.json({ error: 'product_id and barcode are required' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Verify barcode is not already in use
    const existing = await odoo.searchRead(
      'product.product',
      [['barcode', '=', barcode]],
      ['id', 'name'],
      { limit: 1 },
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: `Barcode already assigned to: ${existing[0].name} (ID ${existing[0].id})` },
        { status: 409 },
      );
    }

    await odoo.write('product.product', [product_id], { barcode });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[barcode-lookup POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

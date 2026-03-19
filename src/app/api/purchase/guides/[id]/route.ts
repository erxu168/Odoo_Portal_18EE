import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/purchase/guides/:id
 *
 * Returns a single purchase list with all product lines.
 * Maps to: purchase.list + purchase.list.line
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const odoo = getOdoo();
    const guideId = parseInt(params.id);

    // Fetch the purchase list
    const [list] = await odoo.read('purchase.list', [guideId], [
      'name', 'description', 'partner_id', 'line_ids', 'company_id'
    ]);

    if (!list) {
      return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
    }

    // Fetch supplier info
    let supplier = null;
    if (list.partner_id) {
      const [partner] = await odoo.read('res.partner', [list.partner_id[0]], [
        'name', 'phone', 'email', 'min_order_value'
      ]);
      supplier = {
        id: partner.id,
        name: partner.name,
        phone: partner.phone || '',
        email: partner.email || '',
        minOrderValue: partner.min_order_value || 0,
      };
    }

    // Fetch all lines with product details
    const lines = await odoo.searchRead(
      'purchase.list.line',
      [['list_id', '=', guideId]],
      [
        'product_id', 'default_qty', 'product_uom_id',
        'partner_id', 'price_unit', 'sequence'
      ],
      { order: 'sequence asc, id asc' }
    );

    // Get product names + default codes in one call
    const productIds = lines.map((l: any) => l.product_id[0]);
    let productMap: Record<number, any> = {};
    if (productIds.length > 0) {
      const products = await odoo.read('product.product', productIds, [
        'name', 'default_code', 'uom_id', 'standard_price'
      ]);
      for (const p of products) {
        productMap[p.id] = p;
      }
    }

    const guideLines = lines.map((l: any) => {
      const prod = productMap[l.product_id[0]] || {};
      return {
        id: l.id,
        productId: l.product_id[0],
        productName: prod.name || l.product_id[1],
        defaultCode: prod.default_code || '',
        defaultQty: l.default_qty || 0,
        uom: l.product_uom_id ? l.product_uom_id[1] : (prod.uom_id ? prod.uom_id[1] : ''),
        uomId: l.product_uom_id ? l.product_uom_id[0] : (prod.uom_id ? prod.uom_id[0] : 0),
        priceUnit: l.price_unit || prod.standard_price || 0,
        partnerId: l.partner_id ? l.partner_id[0] : false,
        partnerName: l.partner_id ? l.partner_id[1] : '',
        sequence: l.sequence,
      };
    });

    return NextResponse.json({
      id: list.id,
      name: list.name,
      description: list.description || '',
      supplier,
      lines: guideLines,
    });
  } catch (err: any) {
    console.error(`[API] GET /purchase/guides/${params.id} error:`, err.message);
    return NextResponse.json(
      { error: 'Failed to load guide', detail: err.message },
      { status: 500 }
    );
  }
}

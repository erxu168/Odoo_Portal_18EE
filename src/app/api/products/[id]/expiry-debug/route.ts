/**
 * GET /api/products/[id]/expiry-debug
 * 
 * Diagnostic endpoint to check what expiration fields exist on a product.
 * Returns all fields containing 'expir' or 'life' or 'shelf' from product.template.
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const odoo = getOdoo();
    const productId = parseInt(params.id);

    // Step 1: Get product variant info
    const variants = await odoo.read('product.product', [productId], [
      'name', 'product_tmpl_id',
    ]);
    if (!variants.length) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    const tmplId = variants[0].product_tmpl_id[0];

    // Step 2: Get ALL fields on product.template to find expiry-related ones
    const allFields = await odoo.call('product.template', 'fields_get', [], {
      attributes: ['string', 'type', 'help'],
    });

    // Filter to expiry/life/shelf/expiration related fields
    const expiryFields: Record<string, any> = {};
    for (const [fname, fdef] of Object.entries(allFields as Record<string, any>)) {
      const searchStr = `${fname} ${fdef.string || ''} ${fdef.help || ''}`.toLowerCase();
      if (
        searchStr.includes('expir') ||
        searchStr.includes('life') ||
        searchStr.includes('shelf') ||
        searchStr.includes('best_before') ||
        searchStr.includes('removal') ||
        searchStr.includes('alert') ||
        searchStr.includes('use_date')
      ) {
        expiryFields[fname] = {
          label: fdef.string,
          type: fdef.type,
          help: fdef.help || null,
        };
      }
    }

    // Step 3: Read the actual values of those fields
    const fieldNames = Object.keys(expiryFields);
    let fieldValues: Record<string, any> = {};
    if (fieldNames.length > 0) {
      const templates = await odoo.read('product.template', [tmplId], fieldNames);
      if (templates.length > 0) {
        fieldValues = templates[0];
      }
    }

    return NextResponse.json({
      product_id: productId,
      product_name: variants[0].name,
      product_tmpl_id: tmplId,
      expiry_field_definitions: expiryFields,
      expiry_field_values: fieldValues,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed', stack: error.stack },
      { status: 500 },
    );
  }
}

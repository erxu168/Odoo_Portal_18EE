/**
 * GET /api/products/[id]/expiry-debug
 *
 * Diagnostic endpoint — admin only.
 * Returns all expiration-related fields from product.template.
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireRole('admin');
    const odoo = getOdoo();
    const inputId = parseInt(params.id);

    // Try as product.product first, fall back to product.template
    let tmplId: number;
    let productName: string;
    try {
      const variants = await odoo.read('product.product', [inputId], [
        'name', 'product_tmpl_id',
      ]);
      if (variants.length > 0) {
        tmplId = variants[0].product_tmpl_id[0];
        productName = variants[0].name;
      } else {
        // Try as template ID directly
        const templates = await odoo.read('product.template', [inputId], ['name']);
        if (!templates.length) {
          return NextResponse.json({ error: 'Not found as product.product or product.template' }, { status: 404 });
        }
        tmplId = inputId;
        productName = templates[0].name;
      }
    } catch {
      // If product.product read fails, try template
      const templates = await odoo.read('product.template', [inputId], ['name']);
      if (!templates.length) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      tmplId = inputId;
      productName = templates[0].name;
    }

    // Get ALL fields on product.template to find expiry-related ones
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

    // Read the actual values of those fields
    const fieldNames = Object.keys(expiryFields);
    let fieldValues: Record<string, any> = {};
    if (fieldNames.length > 0) {
      const templates = await odoo.read('product.template', [tmplId], fieldNames);
      if (templates.length > 0) {
        fieldValues = templates[0];
      }
    }

    return NextResponse.json({
      product_name: productName,
      product_tmpl_id: tmplId,
      input_id: inputId,
      expiry_field_definitions: expiryFields,
      expiry_field_values: fieldValues,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('GET /api/products/expiry-debug error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch expiry debug data' },
      { status: 500 },
    );
  }
}

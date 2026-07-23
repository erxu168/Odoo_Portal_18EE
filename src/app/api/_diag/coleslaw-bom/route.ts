export const dynamic = 'force-dynamic';
/**
 * TEMPORARY diagnostic — read the coleslaw BOM + related products from Odoo so we
 * can model the multi-stage coleslaw inventory. Token-gated and short-lived; this
 * file is removed immediately after the one read.
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

const TOKEN = 'kw-bom-9f3ac7e21b4d';

/** Build an Odoo prefix-notation OR domain over `name ilike <term>`. */
function orName(field: string, terms: string[]): unknown[] {
  const conds = terms.map((t) => [field, 'ilike', t]);
  return [...Array(terms.length - 1).fill('|'), ...conds];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const odoo = getOdoo();

    // BOMs whose product mentions coleslaw / slaw.
    const boms = await odoo.searchRead(
      'mrp.bom',
      ['|', ['product_tmpl_id.name', 'ilike', 'coleslaw'], ['product_tmpl_id.name', 'ilike', 'slaw']],
      ['id', 'code', 'product_tmpl_id', 'product_id', 'product_qty', 'product_uom_id', 'type', 'bom_line_ids'],
      { limit: 50 },
    );

    const lineIds = boms.flatMap((b: { bom_line_ids?: number[] }) => b.bom_line_ids || []);
    const lines = lineIds.length
      ? await odoo.read('mrp.bom.line', lineIds, ['id', 'bom_id', 'product_id', 'product_qty', 'product_uom_id'])
      : [];

    // Products matching coleslaw + its likely ingredients, so we know what exists.
    const products = await odoo.searchRead(
      'product.product',
      orName('name', ['coleslaw', 'slaw', 'cabbage', 'onion', 'carrot', 'mayo']),
      ['id', 'name', 'uom_id', 'categ_id', 'default_code', 'type'],
      { limit: 150, context: { active_test: false } },
    );

    return NextResponse.json({ boms, lines, products });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

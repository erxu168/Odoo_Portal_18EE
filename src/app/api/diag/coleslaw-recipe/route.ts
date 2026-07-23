export const dynamic = 'force-dynamic';
/**
 * TEMPORARY, token-gated ops endpoint — change the coleslaw BOM (#163) cabbage
 * to a 2:1 white:red split, total unchanged (6.619 kg): white 4.413, add red
 * 2.206. Idempotent (re-running just re-sets the same qtys). Removed right after.
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

const TOKEN = 'kw-bom-9f3ac7e21b4d';
const BOM_ID = 163;
const WHITE = 1257; // Cabbage, white
const RED = 1580;   // Cabbage, red
const UOM_KG = 12;
const WHITE_QTY = 4.413;
const RED_QTY = 2.206;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('token') !== TOKEN) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const odoo = getOdoo();
    const pid = (l: { product_id: unknown }) => (Array.isArray(l.product_id) ? l.product_id[0] : l.product_id);

    const cabLines = await odoo.searchRead(
      'mrp.bom.line',
      [['bom_id', '=', BOM_ID], ['product_id', 'in', [WHITE, RED]]],
      ['id', 'product_id', 'product_qty'], { limit: 10 },
    );
    const whiteLine = cabLines.find((l: { product_id: unknown }) => pid(l) === WHITE);
    if (!whiteLine) {
      return NextResponse.json({ error: 'white cabbage line not found — BOM changed', cabLines }, { status: 409 });
    }

    await odoo.write('mrp.bom.line', [whiteLine.id], { product_qty: WHITE_QTY });
    const redLine = cabLines.find((l: { product_id: unknown }) => pid(l) === RED);
    if (redLine) await odoo.write('mrp.bom.line', [redLine.id], { product_qty: RED_QTY });
    else await odoo.create('mrp.bom.line', { bom_id: BOM_ID, product_id: RED, product_qty: RED_QTY, product_uom_id: UOM_KG });

    const after = await odoo.searchRead(
      'mrp.bom.line',
      [['bom_id', '=', BOM_ID]],
      ['id', 'product_id', 'product_qty', 'product_uom_id'], { order: 'id', limit: 60 },
    );
    return NextResponse.json({ ok: true, changed: { white: WHITE_QTY, red: RED_QTY, total: WHITE_QTY + RED_QTY }, after });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

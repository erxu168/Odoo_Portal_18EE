/**
 * POST /api/purchase/receive/scan
 * Body: { order_id: number, image_data_url: string }
 *
 * Uploads the delivery-note image to Odoo as an ir.attachment on the linked
 * purchase.order, runs OCR (mock or Azure per OCR_MODE), and correlates the
 * scanned line items back to the order's lines. Does NOT update received_qty
 * — the response just proposes values; the UI asks the user to confirm.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { getOcr, matchOcrToOrder, type MatcherOrderLine } from '@/lib/ocr';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const orderId = parseInt(body.order_id || '0');
  const imageDataUrl: string = body.image_data_url || '';
  if (!orderId) return NextResponse.json({ error: 'order_id required' }, { status: 400 });
  if (!imageDataUrl.startsWith('data:image/')) return NextResponse.json({ error: 'image_data_url must be a data URL' }, { status: 400 });

  const db = getDb();
  const order = db.prepare(
    'SELECT id, odoo_po_id, odoo_po_name FROM purchase_orders WHERE id = ?'
  ).get(orderId) as { id: number; odoo_po_id: number | null; odoo_po_name: string | null } | undefined;
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const orderLines = db.prepare(
    `SELECT id AS line_id, product_name, product_uom, quantity AS ordered_qty, price
       FROM purchase_order_lines WHERE order_id = ?`
  ).all(orderId) as MatcherOrderLine[];

  // Decode data URL → raw bytes + base64 (keep both — Odoo wants base64, OCR wants bytes)
  const match = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (!match) return NextResponse.json({ error: 'Unrecognized data URL format' }, { status: 400 });
  const mime = match[1];
  const base64 = match[2];
  const bytes = Buffer.from(base64, 'base64');

  // 1. Attach to Odoo purchase.order (if we have the link). Non-fatal.
  let attachmentId: number | null = null;
  if (order.odoo_po_id) {
    try {
      const odoo = getOdoo();
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      attachmentId = await odoo.create('ir.attachment', {
        name: `Scan_${order.odoo_po_name || order.id}_${new Date().toISOString().split('T')[0]}.${ext}`,
        type: 'binary',
        datas: base64,
        res_model: 'purchase.order',
        res_id: order.odoo_po_id,
        mimetype: mime,
      });
    } catch (e: any) {
      console.error('[receive/scan] Odoo attachment create failed', e);
    }
  }

  // 2. Run OCR
  let ocrMode: 'mock' | 'azure' = 'mock';
  let ocrError: string | null = null;
  let matched: ReturnType<typeof matchOcrToOrder>['matched'] = [];
  let unmatched_ocr: ReturnType<typeof matchOcrToOrder>['unmatched_ocr'] = [];
  let missing_ordered: ReturnType<typeof matchOcrToOrder>['missing_ordered'] = [];
  let supplier_name: string | undefined;
  let invoice_total: number | undefined;

  try {
    const ocr = getOcr();
    const result = await ocr.scan(bytes, {
      mockHint: orderLines.map((l) => ({ name: l.product_name, qty: l.ordered_qty, price: l.price })),
    });
    ocrMode = result.mode;
    supplier_name = result.supplier_name;
    invoice_total = result.invoice_total;
    const m = matchOcrToOrder(result.lines, orderLines);
    matched = m.matched;
    unmatched_ocr = m.unmatched_ocr;
    missing_ordered = m.missing_ordered;
  } catch (e: any) {
    console.error('[receive/scan] OCR failed', e);
    ocrError = e.message || 'OCR failed';
  }

  return NextResponse.json({
    ocr_mode: ocrMode,
    ocr_error: ocrError,
    attachment_id: attachmentId,
    supplier_name,
    invoice_total,
    matched,
    unmatched_ocr,
    missing_ordered,
  });
}

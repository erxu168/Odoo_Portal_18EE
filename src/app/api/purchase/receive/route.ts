/**
 * /api/purchase/receive
 * GET  - list orders pending receipt for a location, or get receipt for specific order
 * POST - create or update a receipt
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { listOrders, createReceipt, getReceipt, getReceiptByOrder, updateReceiptLine, confirmReceipt, updateReceiptNote, getOrder } from '@/lib/purchase-db';
import { getUserById } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

// Minimum cap on delivery-note payloads (data URL string length). ~15MB b64 ≈ 11MB decoded.
const MAX_IMAGE_DATA_URL_BYTES = 15 * 1024 * 1024;

// HTML-escape untrusted strings before interpolating into Odoo message_post bodies.
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = parseInt(searchParams.get('location_id') || '0');
  const orderId = searchParams.get('order_id');

  // Get receipt for a specific order
  if (orderId) {
    const order = getOrder(parseInt(orderId));
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    let receipt = getReceiptByOrder(parseInt(orderId));
    if (!receipt) {
      const rid = createReceipt(parseInt(orderId), user.id);
      if (rid) receipt = getReceipt(rid);
    }

    const orderer = getUserById(order.ordered_by);

    const orderLineMap: Record<number, any> = {};
    for (const ol of order.lines) {
      orderLineMap[ol.id] = ol;
    }
    if (receipt?.lines) {
      for (const rl of receipt.lines) {
        const ol = orderLineMap[rl.order_line_id];
        if (ol) {
          rl.price = ol.price;
          rl.subtotal = ol.subtotal;
          if (!rl.product_uom || rl.product_uom === 'Units') {
            rl.product_uom = ol.product_uom || 'Units';
          }
        }
      }
    }

    return NextResponse.json({
      receipt,
      order: {
        id: order.id,
        supplier_name: order.supplier_name,
        odoo_po_name: order.odoo_po_name,
        odoo_po_id: order.odoo_po_id,
        ordered_by_name: orderer?.name || 'Unknown',
        created_at: order.created_at,
        delivery_date: order.delivery_date,
        order_note: order.order_note,
        total_amount: order.total_amount,
        status: order.status,
        lines: order.lines,
      }
    });
  }

  if (!locationId) return NextResponse.json({ error: 'location_id required' }, { status: 400 });

  const sentOrders = listOrders(locationId, { status: 'sent' });
  const partialOrders = listOrders(locationId, { status: 'partial' });

  return NextResponse.json({ pending: [...sentOrders, ...partialOrders] });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { action } = body;

  if (action === 'start') {
    const { order_id } = body;
    if (!order_id) return NextResponse.json({ error: 'order_id required' }, { status: 400 });
    const receiptId = createReceipt(order_id, user.id);
    if (!receiptId) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const receipt = getReceipt(receiptId);
    return NextResponse.json({ receipt }, { status: 201 });
  }

  if (action === 'update_line') {
    const { line_id, received_qty, has_issue, issue_type, issue_photo, issue_notes } = body;
    if (!line_id) return NextResponse.json({ error: 'line_id required' }, { status: 400 });
    updateReceiptLine(line_id, { received_qty, has_issue, issue_type, issue_photo, issue_notes });
    return NextResponse.json({ message: 'Line updated' });
  }

  // Reject oversize delivery-note photos before they reach Odoo or the DB.
  if (typeof body?.delivery_note_photo === 'string' && body.delivery_note_photo.length > MAX_IMAGE_DATA_URL_BYTES) {
    return NextResponse.json({ error: 'Delivery note photo too large (max ~11MB decoded). Retake or compress.' }, { status: 413 });
  }
  if (typeof body?.issue_photo === 'string' && body.issue_photo.length > MAX_IMAGE_DATA_URL_BYTES) {
    return NextResponse.json({ error: 'Issue photo too large (max ~11MB decoded). Retake or compress.' }, { status: 413 });
  }

  if (action === 'confirm') {
    if (!hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Manager must confirm receipts' }, { status: 403 });
    }
    const { receipt_id, close_order, delivery_note_photo } = body;
    if (!receipt_id) return NextResponse.json({ error: 'receipt_id required' }, { status: 400 });

    // Idempotency guard: prevent double-confirmation
    const existingReceipt = getReceipt(receipt_id);
    if (existingReceipt && existingReceipt.status === 'confirmed') {
      return NextResponse.json({ message: 'Receipt already confirmed' });
    }

    // Save delivery note photo to SQLite
    if (delivery_note_photo) {
      updateReceiptNote(receipt_id, delivery_note_photo);
    }

    confirmReceipt(receipt_id, user.id, close_order !== false);

    // Track per-line stock-update issues so the UI can warn the user instead
    // of silently accepting a receipt whose stock never made it to Odoo.
    const stockWarnings: { product_name: string; product_id: number; reason: string }[] = [];

    // Update stock in Odoo + upload delivery note
    const receipt = getReceipt(receipt_id);
    if (receipt) {
      try {
        const odoo = getOdoo();

        // 1. Update stock quantities — each line in its own try so one Odoo
        //    failure doesn't abort the rest of the flow (attachments, log note).
        for (const line of receipt.lines) {
          if (line.received_qty !== null && line.received_qty > 0) {
            try {
              const quants = await odoo.searchRead('stock.quant',
                [['product_id', '=', line.product_id], ['location_id', '=', receipt.location_id]],
                ['id', 'quantity'], { limit: 1 });

              if (quants && quants.length > 0) {
                await odoo.write('stock.quant', [quants[0].id], {
                  inventory_quantity: quants[0].quantity + line.received_qty,
                });
                await odoo.call('stock.quant', 'action_apply_inventory', [[quants[0].id]]);
              } else {
                stockWarnings.push({
                  product_name: line.product_name,
                  product_id: line.product_id,
                  reason: 'No stock.quant for this product at this location — stock not updated in Odoo',
                });
              }
            } catch (lineErr: any) {
              console.error(`[receive/confirm] stock update failed for line ${line.product_name}:`, lineErr);
              stockWarnings.push({
                product_name: line.product_name,
                product_id: line.product_id,
                reason: lineErr?.message || 'Odoo write failed',
              });
            }
          }
        }

        // 2. Upload delivery note photo to Odoo as log note on purchase.order
        const order = getOrder(receipt.order_id);
        if (order?.odoo_po_id && delivery_note_photo) {
          try {
            // Strip data URL prefix to get raw base64
            const base64Data = delivery_note_photo.replace(/^data:image\/[a-z]+;base64,/, '');

            // Create ir.attachment
            const attachmentId = await odoo.create('ir.attachment', {
              name: `Delivery_Note_${order.odoo_po_name || order.id}_${new Date().toISOString().split('T')[0]}.jpg`,
              type: 'binary',
              datas: base64Data,
              res_model: 'purchase.order',
              res_id: order.odoo_po_id,
              mimetype: 'image/jpeg',
            });

            // Build receipt summary for the log note
            const receivedLines = receipt.lines.filter((l: any) => l.received_qty !== null && l.received_qty > 0);
            const issueLines = receipt.lines.filter((l: any) => l.has_issue === 1);
            const notReceived = receipt.lines.filter((l: any) => l.received_qty === null || l.received_qty === 0);

            let noteHtml = `<p><strong>Receipt confirmed by ${esc(user.name)}</strong></p>`;
            noteHtml += `<p>${receivedLines.length} items received`;
            if (notReceived.length > 0) noteHtml += `, ${notReceived.length} not delivered`;
            if (issueLines.length > 0) noteHtml += `, <span style="color:red">${issueLines.length} with issues</span>`;
            noteHtml += `</p>`;

            // List items with issues
            if (issueLines.length > 0) {
              noteHtml += '<ul>';
              for (const il of issueLines) {
                noteHtml += `<li><strong>${esc(il.product_name)}</strong>: ${esc(il.issue_type || 'Issue')}`;
                if (il.issue_notes) noteHtml += ` - ${esc(il.issue_notes)}`;
                noteHtml += `</li>`;
              }
              noteHtml += '</ul>';
            }

            noteHtml += `<p><em>Delivery note photo attached.</em></p>`;

            // Post log note with attachment
            await odoo.call('purchase.order', 'message_post', [[order.odoo_po_id]], {
              body: noteHtml,
              message_type: 'comment',
              subtype_xmlid: 'mail.mt_note',
              attachment_ids: [attachmentId],
            });

            console.log(`Delivery note uploaded to Odoo PO ${order.odoo_po_name} (attachment ${attachmentId})`);
          } catch (noteErr) {
            console.error('Failed to upload delivery note to Odoo:', noteErr);
            // Don't fail the whole confirm — stock is already updated
          }
        }

        // 3. Post receipt summary even without photo
        if (order?.odoo_po_id && !delivery_note_photo) {
          try {
            const receivedLines = receipt.lines.filter((l: any) => l.received_qty !== null && l.received_qty > 0);
            const issueLines = receipt.lines.filter((l: any) => l.has_issue === 1);
            const notReceived = receipt.lines.filter((l: any) => l.received_qty === null || l.received_qty === 0);

            let noteHtml = `<p><strong>Receipt confirmed by ${esc(user.name)}</strong></p>`;
            noteHtml += `<p>${receivedLines.length} items received`;
            if (notReceived.length > 0) noteHtml += `, ${notReceived.length} not delivered`;
            if (issueLines.length > 0) noteHtml += `, <span style="color:red">${issueLines.length} with issues</span>`;
            noteHtml += `</p>`;

            if (issueLines.length > 0) {
              noteHtml += '<ul>';
              for (const il of issueLines) {
                noteHtml += `<li><strong>${esc(il.product_name)}</strong>: ${esc(il.issue_type || 'Issue')}`;
                if (il.issue_notes) noteHtml += ` - ${esc(il.issue_notes)}`;
                noteHtml += `</li>`;
              }
              noteHtml += '</ul>';
            }

            await odoo.call('purchase.order', 'message_post', [[order.odoo_po_id]], {
              body: noteHtml,
              message_type: 'comment',
              subtype_xmlid: 'mail.mt_note',
            });
          } catch (noteErr) {
            console.error('Failed to post receipt note to Odoo:', noteErr);
          }
        }

      } catch (e) {
        console.error('Failed to update Odoo stock:', e);
      }
    }

    return NextResponse.json({
      message: stockWarnings.length > 0
        ? `Receipt confirmed — ${stockWarnings.length} item(s) could not be updated in Odoo`
        : 'Receipt confirmed and stock updated',
      stock_warnings: stockWarnings,
    });
  }

  if (action === 'delivery_note') {
    const { receipt_id, photo } = body;
    if (!receipt_id || !photo) return NextResponse.json({ error: 'receipt_id and photo required' }, { status: 400 });
    updateReceiptNote(receipt_id, photo);
    return NextResponse.json({ message: 'Delivery note saved' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

/**
 * Compose a purchase order into a human message for the supplier — shared by the
 * email sender (server) and the WhatsApp deep link (client). Plain, unambiguous,
 * and structured the way a supplier expects to read an order.
 */
export interface OrderMsgLine {
  product_name: string;
  quantity: number;
  product_uom: string;
  product_code?: string;
}

export interface OrderMsgOpts {
  supplierName: string;
  fromName?: string;        // ordering restaurant / company
  orderRef?: string | null; // PO number, e.g. P00042
  deliveryDate?: string | null;
  note?: string | null;
  lines: OrderMsgLine[];
}

/** Plain-text order — used for WhatsApp and the email text part. */
export function buildOrderText(o: OrderMsgOpts): string {
  const lines: string[] = [];
  lines.push(`New order${o.orderRef ? ` (${o.orderRef})` : ''} — ${o.supplierName}`);
  if (o.fromName) lines.push(`From: ${o.fromName}`);
  if (o.deliveryDate) lines.push(`Requested delivery: ${o.deliveryDate}`);
  lines.push('');
  for (const l of o.lines) {
    const code = l.product_code ? ` [${l.product_code}]` : '';
    lines.push(`• ${trimNum(l.quantity)} ${l.product_uom} — ${l.product_name}${code}`);
  }
  if (o.note && o.note.trim()) {
    lines.push('');
    lines.push(`Note: ${o.note.trim()}`);
  }
  return lines.join('\n');
}

/** HTML order table for the email body. */
export function buildOrderHtml(o: OrderMsgOpts): string {
  const rows = o.lines
    .map(
      (l) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #EEE;">${esc(l.product_name)}${l.product_code ? ` <span style="color:#9CA3AF;">[${esc(l.product_code)}]</span>` : ''}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEE;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${trimNum(l.quantity)} ${esc(l.product_uom)}</td>
      </tr>`,
    )
    .join('');
  return `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px 22px;color:#1A1A1A;">
    <div style="font-size:13px;color:#F5800A;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">New order</div>
    <h2 style="font-size:20px;margin:6px 0 2px;">${esc(o.supplierName)}</h2>
    ${o.orderRef ? `<div style="color:#6B7280;font-size:13px;font-family:monospace;">${esc(o.orderRef)}</div>` : ''}
    ${o.fromName ? `<div style="color:#6B7280;font-size:14px;margin-top:8px;">Ordered by <strong>${esc(o.fromName)}</strong></div>` : ''}
    ${o.deliveryDate ? `<div style="color:#6B7280;font-size:14px;">Requested delivery: <strong>${esc(o.deliveryDate)}</strong></div>` : ''}
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">
      <thead><tr>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #1A1A1A;font-size:12px;text-transform:uppercase;color:#6B7280;">Product</th>
        <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #1A1A1A;font-size:12px;text-transform:uppercase;color:#6B7280;">Qty</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${o.note && o.note.trim() ? `<div style="margin-top:16px;padding:12px 14px;background:#FFF4E6;border-radius:10px;font-size:14px;"><strong>Note:</strong> ${esc(o.note.trim())}</div>` : ''}
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:22px 0;" />
    <p style="color:#9CA3AF;font-size:11px;text-align:center;">Sent via Krawings Portal</p>
  </div>`;
}

/** Build a wa.me deep link that opens WhatsApp with the order pre-filled. */
export function whatsappLink(phone: string, text: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}
function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

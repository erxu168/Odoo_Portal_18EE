import { NextRequest, NextResponse } from 'next/server';
import { getOdoo, parseOdooDate } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

/**
 * GET /api/manufacturing-orders/:id/print
 * Generate a printable HTML page for a manufacturing order.
 * Returns HTML that can be opened in a new tab and printed via browser.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    requireAuth();
    const moId = parseInt(params.id);
    const odoo = getOdoo();

    // Fetch MO
    const mos = await odoo.read('mrp.production', [moId], [
      'name', 'product_id', 'product_qty', 'product_uom_id', 'state',
      'date_start', 'date_deadline', 'date_finished', 'bom_id',
      'qty_producing', 'workorder_ids', 'move_raw_ids', 'company_id', 'create_date',
    ]);
    if (!mos?.length) {
      return new NextResponse('MO not found', { status: 404 });
    }
    const mo = mos[0];

    // Fetch components
    const components = mo.move_raw_ids?.length
      ? await odoo.read('stock.move', mo.move_raw_ids, [
          'product_id', 'product_uom_qty', 'product_uom', 'picked',
        ])
      : [];

    // Fetch work orders
    const workOrders = mo.workorder_ids?.length
      ? await odoo.read('mrp.workorder', mo.workorder_ids, [
          'name', 'workcenter_id', 'state', 'duration_expected',
        ])
      : [];

    // Fetch BOM operations for instructions
    let operations: any[] = [];
    if (mo.bom_id?.[0]) {
      const boms = await odoo.read('mrp.bom', [mo.bom_id[0]], ['operation_ids']);
      if (boms?.[0]?.operation_ids?.length) {
        operations = await odoo.read('mrp.routing.workcenter', boms[0].operation_ids, [
          'name', 'workcenter_id', 'time_cycle_manual', 'note', 'sequence',
        ]);
        operations.sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0));
      }
    }

    const stateLabels: Record<string, string> = {
      draft: 'Draft', confirmed: 'Confirmed', progress: 'In Progress',
      done: 'Done', to_close: 'To Close', cancel: 'Cancelled',
    };

    const fmtDate = (d: string | false) => {
      if (!d) return '-';
      const parsed = parseOdooDate(d);
      if (!parsed) return '-';
      return parsed.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
    };

    const fmtNum = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(n);

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <title>${mo.name} — ${mo.product_id[1]}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1F2933; font-size: 13px; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #16A34A; padding-bottom: 12px; margin-bottom: 16px; }
    .header h1 { font-size: 22px; font-weight: 800; }
    .header .ref { font-size: 13px; color: #6B7280; margin-top: 2px; }
    .header .meta { text-align: right; font-size: 12px; color: #6B7280; }
    .header .state { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; background: #F3F4F6; color: #374151; }
    .section { margin-bottom: 16px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #9CA3AF; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9CA3AF; padding: 6px 8px; border-bottom: 1px solid #E5E7EB; }
    td { padding: 8px; border-bottom: 1px solid #F3F4F6; font-size: 13px; }
    td.qty { text-align: right; font-family: 'DM Mono', monospace; font-weight: 700; }
    td.uom { color: #6B7280; font-size: 12px; }
    .checkbox { display: inline-block; width: 16px; height: 16px; border: 1.5px solid #D1D5DB; border-radius: 3px; vertical-align: middle; margin-right: 6px; }
    .step { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #F3F4F6; }
    .step-num { width: 28px; height: 28px; border-radius: 8px; background: #FEF3C7; color: #92400E; font-weight: 700; font-size: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step-body { flex: 1; }
    .step-name { font-weight: 700; font-size: 14px; }
    .step-meta { font-size: 12px; color: #6B7280; margin-top: 2px; }
    .step-note { font-size: 12px; color: #374151; margin-top: 6px; padding: 8px; background: #F9FAFB; border-radius: 6px; border-left: 3px solid #D1D5DB; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .info-box { padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; text-align: center; }
    .info-box .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9CA3AF; }
    .info-box .value { font-size: 18px; font-weight: 700; margin-top: 2px; font-family: 'DM Mono', monospace; }
    .print-btn { position: fixed; bottom: 20px; right: 20px; padding: 12px 24px; background: #16A34A; color: white; border: none; border-radius: 12px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(22,163,74,0.3); }
    .print-btn:hover { background: #15803D; }
    @media print { .print-btn { display: none; } }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #E5E7EB; font-size: 11px; color: #9CA3AF; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${mo.product_id[1]}</h1>
      <div class="ref">${mo.name}${mo.bom_id ? ' \u00b7 ' + mo.bom_id[1] : ''}</div>
    </div>
    <div class="meta">
      <span class="state">${stateLabels[mo.state] || mo.state}</span><br/>
      <span>Created: ${fmtDate(mo.create_date)}</span><br/>
      ${mo.date_deadline ? '<span>Planned: ' + fmtDate(mo.date_deadline) + '</span>' : ''}
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <div class="label">Quantity</div>
      <div class="value">${fmtNum(mo.product_qty)}</div>
      <div style="font-size:11px;color:#6B7280">${mo.product_uom_id[1]}</div>
    </div>
    <div class="info-box">
      <div class="label">Ingredients</div>
      <div class="value">${components.length}</div>
    </div>
    <div class="info-box">
      <div class="label">Steps</div>
      <div class="value">${workOrders.length}</div>
    </div>
  </div>

  ${components.length > 0 ? `
  <div class="section">
    <div class="section-title">Ingredients</div>
    <table>
      <thead><tr><th></th><th>Ingredient</th><th style="text-align:right">Quantity</th><th>UOM</th></tr></thead>
      <tbody>
        ${components.map((c: any) => `
          <tr>
            <td><span class="checkbox"></span></td>
            <td>${c.product_id[1]}</td>
            <td class="qty">${fmtNum(c.product_uom_qty)}</td>
            <td class="uom">${c.product_uom[1]}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>` : ''}

  ${(operations.length > 0 || workOrders.length > 0) ? `
  <div class="section">
    <div class="section-title">Work Order Steps</div>
    ${operations.length > 0 ? operations.map((op: any, i: number) => `
      <div class="step">
        <div class="step-num">${i + 1}</div>
        <div class="step-body">
          <div class="step-name">${op.name}</div>
          <div class="step-meta">${op.workcenter_id?.[1] || ''}${op.time_cycle_manual > 0 ? ' \u00b7 ' + op.time_cycle_manual + ' min' : ''}</div>
          ${op.note ? '<div class="step-note">' + op.note.replace(/<[^>]*>/g, '') + '</div>' : ''}
        </div>
      </div>
    `).join('') : workOrders.map((wo: any, i: number) => `
      <div class="step">
        <div class="step-num">${i + 1}</div>
        <div class="step-body">
          <div class="step-name">${wo.name}</div>
          <div class="step-meta">${wo.workcenter_id?.[1] || ''}${wo.duration_expected > 0 ? ' \u00b7 ' + Math.round(wo.duration_expected) + ' min' : ''}</div>
        </div>
      </div>
    `).join('')}
  </div>` : ''}

  <div class="footer">
    <span>${mo.company_id?.[1] || 'Krawings'}</span>
    <span>Printed ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })}</span>
  </div>

  <button class="print-btn" onclick="window.print()">Print</button>
</body>
</html>`;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('GET /api/manufacturing-orders/[id]/print error:', err);
    return new NextResponse('Failed to generate print view', { status: 500 });
  }
}

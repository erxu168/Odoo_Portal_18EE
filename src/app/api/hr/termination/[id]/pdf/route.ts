/**
 * GET /api/hr/termination/[id]/pdf — download termination PDF
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

const REPORT_MAP: Record<string, string> = {
  ordentlich: 'krawings_termination.report_ordentliche_kuendigung',
  ordentlich_probezeit: 'krawings_termination.report_ordentliche_kuendigung',
  fristlos: 'krawings_termination.report_fristlose_kuendigung',
  aufhebung: 'krawings_termination.report_aufhebungsvertrag',
  bestaetigung: 'krawings_termination.report_kuendigungsbestaetigung',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const odoo = getOdoo();
    const records = await odoo.read('kw.termination', [recordId], ['termination_type', 'employee_name', 'letter_date']);

    if (!records || records.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rec = records[0];
    const reportName = REPORT_MAP[rec.termination_type] || REPORT_MAP.ordentlich;

    // Fetch PDF from Odoo report endpoint
    const odooUrl = process.env.ODOO_URL || 'http://127.0.0.1:15069';
    const db = process.env.ODOO_DB || 'krawings';
    const login = process.env.ODOO_USER || 'biz@krawings.de';
    const password = process.env.ODOO_PASSWORD || '';

    // Authenticate to get session
    const authRes = await fetch(`${odooUrl}/web/session/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', params: { db, login, password },
      }),
    });

    const cookies = authRes.headers.get('set-cookie') || '';
    const sessionMatch = cookies.match(/session_id=([^;]+)/);
    if (!sessionMatch) {
      return NextResponse.json({ error: 'Odoo auth failed' }, { status: 500 });
    }

    const pdfUrl = `${odooUrl}/report/pdf/${reportName}/${recordId}`;
    const pdfRes = await fetch(pdfUrl, {
      headers: { Cookie: `session_id=${sessionMatch[1]}` },
    });

    if (!pdfRes.ok) {
      return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
    }

    const pdfBuffer = await pdfRes.arrayBuffer();
    const safeName = (rec.employee_name || 'Kuendigung').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `Kuendigung_${safeName}_${rec.letter_date}.pdf`;

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

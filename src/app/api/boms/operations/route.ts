import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/boms/operations?id=X
 * Download worksheet PDF for an operation.
 */
export async function GET(req: NextRequest) {
  try {
    const opId = parseInt(req.nextUrl.searchParams.get('id') || '0');
    if (!opId) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const odoo = getOdoo();
    const ops = await odoo.read('mrp.routing.workcenter', [opId], ['worksheet', 'name']);
    if (!ops?.length || !ops[0].worksheet) {
      return NextResponse.json({ ok: false, error: 'No worksheet' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      data_base64: ops[0].worksheet,
      mimetype: 'application/pdf',
      name: `${ops[0].name || 'worksheet'}.pdf`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/boms/operations?id=X
 * Upload worksheet PDF for an operation.
 * Body: { file_base64: string }
 */
export async function POST(req: NextRequest) {
  try {
    const opId = parseInt(req.nextUrl.searchParams.get('id') || '0');
    if (!opId) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const odoo = getOdoo();
    const body = await req.json();
    let fileData = body.file_base64 || '';

    // Strip data URL prefix
    if (fileData.startsWith('data:')) {
      fileData = fileData.replace(/^data:[^;]+;base64,/, '');
    }

    await odoo.write('mrp.routing.workcenter', [opId], {
      worksheet: fileData || false,
      worksheet_type: fileData ? 'pdf' : false,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

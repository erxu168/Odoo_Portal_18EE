import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const MODEL = 'kw.termination';

/**
 * POST /api/termination/:id/upload-proof
 * Upload a courier confirmation PDF/image (delivery proof).
 * Creates ir.attachment and links to delivery_proof_attachment_id.
 *
 * Body: { file_base64: string, filename?: string, mimetype?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireRole('manager');
    const { id } = await params;
    const termId = Number(id);
    const body = await req.json();
    const { filename } = body;
    let fileData: string = body.file_base64;
    let mimetype: string = body.mimetype || 'application/pdf';

    if (!fileData) {
      return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 });
    }

    // Strip data URL prefix if present
    if (fileData.startsWith('data:')) {
      const match = fileData.match(/^data:([^;]+);base64,/);
      if (match) {
        mimetype = match[1];
        fileData = fileData.replace(/^data:[^;]+;base64,/, '');
      }
    }

    const attachFilename = filename || `Zustellnachweis_${termId}.pdf`;
    const odoo = getOdoo();

    // Create ir.attachment
    const attachId = await odoo.create('ir.attachment', {
      name: attachFilename,
      type: 'binary',
      datas: fileData,
      res_model: MODEL,
      res_id: termId,
      mimetype,
    });

    // Link to termination record
    await odoo.write(MODEL, [termId], {
      delivery_proof_attachment_id: attachId,
    });

    // Post to chatter
    try {
      await odoo.call(MODEL, 'message_post', [[termId]], {
        body: `<p>Zustellnachweis hochgeladen (via Portal): ${attachFilename}</p>`,
        message_type: 'comment',
        subtype_xmlid: 'mail.mt_note',
        attachment_ids: [attachId],
      });
    } catch (_e: unknown) {
      // Non-critical
    }

    return NextResponse.json({ ok: true, attachment_id: attachId });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/termination/[id]/upload-proof error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/termination/:id/upload-proof
 * Download the delivery proof attachment.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireRole('manager');
    const { id } = await params;
    const termId = Number(id);
    const odoo = getOdoo();

    const records = await odoo.read(MODEL, [termId], ['delivery_proof_attachment_id']);
    const proofField = records?.[0]?.delivery_proof_attachment_id;
    if (!proofField || proofField === false) {
      return NextResponse.json({ ok: false, error: 'No proof uploaded' }, { status: 404 });
    }

    const attachId = Array.isArray(proofField) ? proofField[0] : proofField;
    const attachments = await odoo.read('ir.attachment', [attachId], ['datas', 'mimetype', 'name']);
    if (!attachments?.length) {
      return NextResponse.json({ ok: false, error: 'Attachment not found' }, { status: 404 });
    }

    const att = attachments[0];
    return NextResponse.json({
      ok: true,
      data_base64: att.datas,
      mimetype: att.mimetype,
      name: att.name,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/termination/:id/upload-proof
 * Remove the courier-confirmation attachment (manager; confirmed client-side).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireRole('manager');
    const { id } = await params;
    const termId = Number(id);
    const odoo = getOdoo();

    const cur = (await odoo.read(MODEL, [termId], ['state', 'delivery_proof_attachment_id']))?.[0];
    if (!cur) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    if (['archived', 'cancelled'].includes(cur.state)) {
      return NextResponse.json({ ok: false, error: 'This record can no longer be changed.' }, { status: 409 });
    }
    const proofId = Array.isArray(cur.delivery_proof_attachment_id) ? cur.delivery_proof_attachment_id[0] : cur.delivery_proof_attachment_id;
    if (!proofId) return NextResponse.json({ ok: false, error: 'No courier confirmation to delete.' }, { status: 404 });

    await odoo.write(MODEL, [termId], { delivery_proof_attachment_id: false });
    const att = (await odoo.read('ir.attachment', [proofId], ['res_model', 'res_id']))?.[0];
    if (att && att.res_model === MODEL && att.res_id === termId) {
      try { await odoo.call('ir.attachment', 'unlink', [[proofId]]); } catch { /* orphan ok */ }
    }
    try {
      await odoo.call(MODEL, 'message_post', [[termId]], {
        body: '<p>Courier confirmation removed (via portal).</p>',
        message_type: 'comment', subtype_xmlid: 'mail.mt_note',
      });
    } catch {}

    const updated = await odoo.read(MODEL, [termId], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: updated[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('DELETE /api/termination/[id]/upload-proof error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

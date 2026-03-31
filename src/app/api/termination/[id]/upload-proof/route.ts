import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

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
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/termination/[id]/upload-proof error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

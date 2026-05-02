import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { exec } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const WKHTMLTOPDF = '/usr/local/bin/wkhtmltopdf';

/**
 * POST /api/termination/:id/upload-signed
 * Accepts a base64 image (photo of wet-signed document),
 * converts it to PDF, creates an ir.attachment in Odoo,
 * and links it as signed_pdf_attachment_id on the termination record.
 *
 * Body: { image_base64: string, filename?: string }
 * image_base64 can be a data URL or raw base64.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const termId = Number(id);
    const body = await req.json();
    const { image_base64: rawImage, filename } = body;

    let image_base64 = rawImage;
    if (!image_base64) {
      return NextResponse.json({ ok: false, error: 'No image provided' }, { status: 400 });
    }

    // Strip data URL prefix if present
    let mimeType = 'image/jpeg';
    if (image_base64.startsWith('data:')) {
      const match = image_base64.match(/^data:(image\/[^;]+);base64,/);
      if (match) {
        mimeType = match[1];
        image_base64 = image_base64.replace(/^data:image\/[^;]+;base64,/, '');
      }
    }

    // Also handle PDF uploads directly (no conversion needed)
    const isPdf = mimeType === 'application/pdf' || (
      image_base64.startsWith('data:application/pdf') ||
      body.image_base64?.startsWith('data:application/pdf')
    );

    let pdfBase64: string;

    if (isPdf) {
      // Already a PDF, just strip the data URL prefix
      pdfBase64 = image_base64.replace(/^data:application\/pdf;base64,/, '');
    } else {
      // Convert image to PDF using wkhtmltopdf
      const uid = randomBytes(8).toString('hex');
      const imgPath = join(tmpdir(), `kw_signed_${uid}.img`);
      const htmlPath = join(tmpdir(), `kw_signed_${uid}.html`);
      const pdfPath = join(tmpdir(), `kw_signed_${uid}.pdf`);

      // Write image to temp file
      const imgBuffer = Buffer.from(image_base64, 'base64');
      writeFileSync(imgPath, imgBuffer);

      // Create HTML wrapper that fills the page with the image
      const ext = mimeType.split('/')[1] || 'jpeg';
      const dataUrl = `data:${mimeType};base64,${image_base64}`;
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>
  @page { size: A4; margin: 5mm; }
  body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  img { max-width: 100%; max-height: 100vh; object-fit: contain; }
</style></head>
<body><img src="${dataUrl}"/></body></html>`;

      writeFileSync(htmlPath, html, 'utf-8');

      // Convert to PDF
      await new Promise<void>((resolve, reject) => {
        const cmd = `${WKHTMLTOPDF} --encoding utf-8 --page-size A4 --margin-top 5mm --margin-bottom 5mm --margin-left 5mm --margin-right 5mm --dpi 150 --quiet "${htmlPath}" "${pdfPath}"`;
        exec(cmd, { timeout: 30000 }, (err) => {
          // Clean up temp files
          try { unlinkSync(imgPath); } catch {}
          try { unlinkSync(htmlPath); } catch {}
          if (err) {
            try { unlinkSync(pdfPath); } catch {}
            reject(new Error('PDF conversion failed'));
          } else {
            resolve();
          }
        });
      });

      const pdfBuffer = readFileSync(pdfPath);
      try { unlinkSync(pdfPath); } catch {}
      pdfBase64 = pdfBuffer.toString('base64');
    }

    // Read old pdf_attachment_id before creating the new one
    const odoo = getOdoo();
    let oldPdfAttachId: number | null = null;
    try {
      const current = await odoo.read('kw.termination', [termId], ['pdf_attachment_id']);
      if (current?.[0]?.pdf_attachment_id) {
        oldPdfAttachId = Array.isArray(current[0].pdf_attachment_id)
          ? current[0].pdf_attachment_id[0]
          : current[0].pdf_attachment_id;
      }
    } catch (_e) {}

    // Create ir.attachment in Odoo
    const attachFilename = filename || `Kuendigung_unterschrieben_${termId}.pdf`;

    const attachId = await odoo.create('ir.attachment', {
      name: attachFilename,
      type: 'binary',
      datas: pdfBase64,
      res_model: 'kw.termination',
      res_id: termId,
      mimetype: 'application/pdf',
    });

    // Link to termination record
    await odoo.write('kw.termination', [termId], {
      pdf_attachment_id: attachId,
      signed_pdf_attachment_id: attachId,
    });

    // Delete old unsigned PDF attachment if different from the new signed one
    if (oldPdfAttachId && oldPdfAttachId !== attachId) {
      try {
        await odoo.call('ir.attachment', 'unlink', [[oldPdfAttachId]]);
      } catch (_e) {
        // Non-critical — orphaned attachment is harmless
      }
    }

    // Post to chatter
    try {
      await odoo.call('kw.termination', 'message_post', [[termId]], {
        body: '<p>Unterschriebenes Dokument hochgeladen (via Portal).</p>',
        message_type: 'comment',
        subtype_xmlid: 'mail.mt_note',
        attachment_ids: [attachId],
      });
    } catch {}

    // Return full updated record for the frontend to consume
    const updatedRecords = await odoo.read('kw.termination', [termId], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: updatedRecords[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/termination/[id]/upload-signed error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

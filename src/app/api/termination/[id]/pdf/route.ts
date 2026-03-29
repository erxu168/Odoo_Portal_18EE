import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { buildLetterHtml, generatePdf } from '@/lib/termination-pdf';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const MODEL = 'kw.termination';

function formatDate(d: string | false): string {
  if (!d) return '---';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

/**
 * POST /api/termination/:id/pdf
 * Generate the termination letter PDF, store it in Odoo, return the PDF.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const odoo = getOdoo();
    const numId = Number(id);

    const records = await odoo.read(MODEL, [numId], TERMINATION_DETAIL_FIELDS);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const rec = records[0];

    const companyId = rec.company_id[0];
    const companies = await odoo.read('res.company', [companyId], [
      'name', 'street', 'zip', 'city', 'phone', 'email', 'vat', 'logo',
    ]);
    const company = companies[0];

    const empId = rec.employee_id[0];
    const employees = await odoo.read('hr.employee', [empId], ['gender']);
    const empGender = employees[0]?.gender || 'other';

    let logoBase64: string | null = null;
    if (company.logo) {
      logoBase64 = `data:image/png;base64,${company.logo}`;
    }

    const html = buildLetterHtml({
      companyName: company.name || '',
      companyStreet: company.street || '',
      companyZip: company.zip || '',
      companyCity: company.city || '',
      companyPhone: company.phone || '',
      companyEmail: company.email || '',
      companyVat: company.vat || '',
      companyLogoBase64: logoBase64,
      employeeName: rec.employee_name || '',
      employeeStreet: rec.employee_street || '',
      employeeZip: rec.employee_zip || '',
      employeeCity: rec.employee_city || '',
      employeeGender: empGender,
      letterDate: formatDate(rec.letter_date),
      recordId: rec.id,
      lastWorkingDay: formatDate(rec.last_working_day),
      noticePeriodText: rec.notice_period_text || '',
      terminationType: rec.termination_type,
      employeeStartDate: formatDate(rec.employee_start_date),
      includeSeverance: rec.include_severance,
      severanceAmount: rec.severance_amount,
      gardenLeave: rec.garden_leave,
      resignationReceivedDate: formatDate(rec.resignation_received_date),
    });

    const pdfBuffer = await generatePdf(html);

    const filename = `Kuendigung_${(rec.employee_name || 'X').replace(/\s+/g, '_')}_${rec.letter_date}.pdf`;
    const attachmentId = await odoo.create('ir.attachment', {
      name: filename,
      type: 'binary',
      datas: pdfBuffer.toString('base64'),
      res_model: MODEL,
      res_id: numId,
      mimetype: 'application/pdf',
    });

    await odoo.write(MODEL, [numId], { pdf_attachment_id: attachmentId });

    await odoo.call(MODEL, 'message_post', [numId], {
      body: 'PDF erstellt.',
      message_type: 'comment',
      attachment_ids: [attachmentId],
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[termination/pdf]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * GET /api/termination/:id/pdf
 * Download the existing PDF attachment.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const odoo = getOdoo();
    const numId = Number(id);

    const records = await odoo.read(MODEL, [numId], ['pdf_attachment_id', 'employee_name', 'letter_date']);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const rec = records[0];
    if (!rec.pdf_attachment_id) {
      return NextResponse.json({ ok: false, error: 'No PDF generated yet' }, { status: 404 });
    }

    const attId = rec.pdf_attachment_id[0];
    const attachments = await odoo.read('ir.attachment', [attId], ['datas', 'name']);
    if (!attachments || !attachments[0]?.datas) {
      return NextResponse.json({ ok: false, error: 'Attachment not found' }, { status: 404 });
    }

    const pdfBuffer = Buffer.from(attachments[0].datas, 'base64');
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${attachments[0].name}"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

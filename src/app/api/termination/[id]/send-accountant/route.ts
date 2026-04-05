import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { TERMINATION_DETAIL_FIELDS, TERMINATION_TYPE_LABELS } from '@/types/termination';
import type { TerminationType } from '@/types/termination';

const MODEL = 'kw.termination';
const CONFIG_KEY = 'krawings_termination.accountant_email';

/**
 * POST /api/termination/:id/send-accountant
 * Send the termination PDF to the accountant via Odoo mail.mail.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireRole('manager');
    const { id } = await params;
    const odoo = getOdoo();
    const numId = Number(id);

    const records = await odoo.read(MODEL, [numId], [
      'state', 'pdf_attachment_id', 'employee_name', 'company_id',
      'termination_type', 'last_working_day', 'sent_to_accountant',
    ]);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const rec = records[0];

    if (!rec.pdf_attachment_id) {
      return NextResponse.json(
        { ok: false, error: 'No PDF generated yet. Generate the PDF first.' },
        { status: 400 },
      );
    }

    if (rec.sent_to_accountant) {
      return NextResponse.json(
        { ok: false, error: 'Already sent to accountant.' },
        { status: 400 },
      );
    }

    const configResult = await odoo.call(
      'ir.config_parameter', 'get_param', [CONFIG_KEY, ''],
    );
    const accountantEmail = typeof configResult === 'string' ? configResult.trim() : '';

    if (!accountantEmail) {
      return NextResponse.json(
        { ok: false, error: 'Accountant email not configured. Set krawings_termination.accountant_email in Odoo System Parameters.' },
        { status: 400 },
      );
    }

    const typeLabel = TERMINATION_TYPE_LABELS[rec.termination_type as TerminationType] || rec.termination_type;
    const companyName = rec.company_id[1] || '';
    const lastDay = rec.last_working_day
      ? rec.last_working_day.split('-').reverse().join('.')
      : '';
    const subject = `K\u00fcndigung: ${rec.employee_name} - ${companyName}${lastDay ? ` (${lastDay})` : ''}`;

    const body = `<p>Sehr geehrte Damen und Herren,</p>
<p>anbei erhalten Sie das K\u00fcndigungsschreiben f\u00fcr:</p>
<ul>
  <li><strong>Mitarbeiter:</strong> ${rec.employee_name}</li>
  <li><strong>Unternehmen:</strong> ${companyName}</li>
  <li><strong>Art:</strong> ${typeLabel}</li>
  ${lastDay ? `<li><strong>Letzter Arbeitstag:</strong> ${lastDay}</li>` : ''}
</ul>
<p>Mit freundlichen Gr\u00fc\u00dfen<br/>${companyName}</p>`;

    const attId = rec.pdf_attachment_id[0];
    const mailId = await odoo.create('mail.mail', {
      subject,
      email_to: accountantEmail,
      body_html: body,
      attachment_ids: [[4, attId]],
    });

    await odoo.call('mail.mail', 'send', [[mailId]]);

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await odoo.write(MODEL, [numId], {
      sent_to_accountant: true,
      sent_to_accountant_date: now,
    });

    await odoo.call(MODEL, 'message_post', [numId], {
      body: `K\u00fcndigungsschreiben an Steuerberater gesendet: ${accountantEmail}`,
      message_type: 'comment',
    });

    const updated = await odoo.read(MODEL, [numId], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: updated[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[termination/send-accountant]', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

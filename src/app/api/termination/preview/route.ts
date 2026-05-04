import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { buildLetterHtml, generatePdf } from '@/lib/termination-pdf';

function formatDate(d: string | false): string {
  if (!d) return '---';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

/**
 * POST /api/termination/preview
 * Generate a PDF preview from wizard data WITHOUT creating an Odoo record.
 * Returns { ok: true, pdfBase64: "..." }
 *
 * Body: {
 *   employee_id: number,
 *   company_id: number,
 *   termination_type: string,
 *   letter_date: string,
 *   last_working_day: string,
 *   notice_period_text: string,
 *   employee_name: string,
 *   employee_street?: string,
 *   employee_zip?: string,
 *   employee_city?: string,
 *   employee_start_date?: string,
 *   tenure_years?: number,
 *   // Fristlos
 *   incident_date?: string,
 *   // Aufhebung
 *   include_severance?: boolean,
 *   severance_amount?: number,
 *   garden_leave?: boolean,
 *   // Bestaetigung
 *   resignation_received_date?: string,
 * }
 */
export async function POST(req: NextRequest) {
  try {
    requireRole('manager');
    const odoo = getOdoo();
    const body = await req.json();

    if (!body.employee_id || !body.termination_type) {
      return NextResponse.json(
        { ok: false, error: 'employee_id and termination_type are required' },
        { status: 400 },
      );
    }

    // Fetch company data + logo
    const companyId = body.company_id;
    const companies = await odoo.read('res.company', [companyId], [
      'name', 'street', 'zip', 'city', 'phone', 'email', 'vat', 'logo',
    ]);
    const company = companies[0];

    // Fetch employee gender
    const employees = await odoo.read('hr.employee', [body.employee_id], ['gender']);
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
      employeeName: body.employee_name || '',
      employeeStreet: body.employee_street || '',
      employeeZip: body.employee_zip || '',
      employeeCity: body.employee_city || '',
      employeeGender: empGender,
      letterDate: formatDate(body.letter_date),
      recordId: 0, // Preview — no record yet
      lastWorkingDay: formatDate(body.last_working_day),
      noticePeriodText: body.notice_period_text || '',
      terminationType: body.termination_type,
      employeeStartDate: formatDate(body.employee_start_date),
      includeSeverance: body.include_severance,
      severanceAmount: body.severance_amount,
      gardenLeave: body.garden_leave,
      resignationReceivedDate: formatDate(body.resignation_received_date),
    });

    const pdfBuffer = await generatePdf(html);

    return NextResponse.json({
      ok: true,
      pdfBase64: pdfBuffer.toString('base64'),
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[termination/preview]', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

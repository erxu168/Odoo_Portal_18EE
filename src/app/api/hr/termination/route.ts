/**
 * GET  /api/hr/termination  — list terminations
 * POST /api/hr/termination  — create new termination
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { TERMINATION_LIST_FIELDS } from '@/types/termination';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const companyId = Number(url.searchParams.get('company_id') || 0);
    const state = url.searchParams.get('state');
    const limit = Number(url.searchParams.get('limit') || 50);
    const offset = Number(url.searchParams.get('offset') || 0);
    const search = url.searchParams.get('search') || '';

    const domain: unknown[][] = [];
    if (companyId) domain.push(['company_id', '=', companyId]);
    if (state) domain.push(['state', '=', state]);
    if (search) domain.push(['employee_name', 'ilike', search]);

    const odoo = getOdoo();
    const records = await odoo.searchRead(
      'kw.termination',
      domain,
      [...TERMINATION_LIST_FIELDS],
      { limit, offset, order: 'letter_date desc, id desc' },
    );

    const total = await odoo.call('kw.termination', 'search_count', [domain]);

    return NextResponse.json({ records, total });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const requiredFields = ['employee_id', 'company_id', 'termination_type', 'letter_date', 'calc_method'];
    for (const f of requiredFields) {
      if (!body[f]) {
        return NextResponse.json({ error: `Missing required field: ${f}` }, { status: 400 });
      }
    }

    const vals: Record<string, unknown> = {
      employee_id: body.employee_id,
      company_id: body.company_id,
      termination_type: body.termination_type,
      letter_date: body.letter_date,
      calc_method: body.calc_method,
    };

    if (body.receipt_date) vals.receipt_date = body.receipt_date;
    if (body.resignation_method) vals.resignation_method = body.resignation_method;
    if (body.resignation_received_date) vals.resignation_received_date = body.resignation_received_date;
    if (body.garden_leave !== undefined) vals.garden_leave = body.garden_leave;
    if (body.include_severance !== undefined) vals.include_severance = body.include_severance;
    if (body.severance_amount) vals.severance_amount = body.severance_amount;
    if (body.incident_date) vals.incident_date = body.incident_date;
    if (body.incident_description) vals.incident_description = body.incident_description;

    const odoo = getOdoo();
    const id = await odoo.create('kw.termination', vals);

    return NextResponse.json({ id, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

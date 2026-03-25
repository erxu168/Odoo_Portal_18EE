import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { OdooClient } from '@/lib/odoo';
import { EMPLOYEE_READ_FIELDS } from '@/types/hr';

export async function GET(_req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    const employees = await odoo.searchRead('hr.employee', [
      ['id', '=', user.employee_id],
    ], EMPLOYEE_READ_FIELDS, { limit: 1 });

    if (!employees || employees.length === 0) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    return NextResponse.json({ employee: employees[0] });
  } catch (err: unknown) {
    console.error('GET /api/hr/employee error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch employee' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { fields } = body;

    if (!fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'Missing fields object' }, { status: 400 });
    }

    const WRITABLE = new Set([
      'birthday', 'gender', 'marital', 'country_id', 'place_of_birth',
      'country_of_birth', 'children', 'disabled', 'kw_geburtsname',
      'private_street', 'private_street2', 'private_zip', 'private_city',
      'private_country_id', 'private_email', 'private_phone',
      'emergency_contact', 'emergency_phone',
      'identification_id', 'kw_steuer_id', 'kw_steuerklasse',
      'kw_konfession', 'kw_kinderfreibetrag',
      'ssnid', 'kw_krankenkasse_name', 'kw_kv_typ',
      'kw_beschaeftigungsbeginn', 'kw_wochenarbeitszeit', 'kw_taetigkeit_ba',
      'kw_befristung', 'kw_befristung_bis', 'kw_probezeit_bis',
      'kw_aufenthaltstitel_typ', 'passport_id', 'visa_no', 'permit_no',
      'visa_expire', 'work_permit_expiration_date',
      'kw_gesundheitszeugnis_datum', 'kw_gesundheitszeugnis_ablauf',
      'kw_sofortmeldung_done', 'kw_sofortmeldung_datum',
      'kw_onboarding_status', 'kw_datev_complete',
      'image_1920',
    ]);

    const safeFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (WRITABLE.has(key)) {
        safeFields[key] = value;
      }
    }

    if (Object.keys(safeFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();
    await odoo.write('hr.employee', [user.employee_id], safeFields);

    return NextResponse.json({ success: true, updated: Object.keys(safeFields) });
  } catch (err: unknown) {
    console.error('PUT /api/hr/employee error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update employee' },
      { status: 500 }
    );
  }
}

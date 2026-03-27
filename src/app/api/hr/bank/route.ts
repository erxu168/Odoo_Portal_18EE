import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const odoo = getOdoo();
    const emps = await odoo.searchRead('hr.employee', [['id', '=', user.employee_id]], ['bank_account_id'], { limit: 1 });
    if (!emps.length || !emps[0].bank_account_id) {
      return NextResponse.json({ iban: null });
    }

    const bankId = emps[0].bank_account_id[0];
    const banks = await odoo.searchRead('res.partner.bank', [['id', '=', bankId]], ['acc_number', 'bank_id'], { limit: 1 });
    if (!banks.length) {
      return NextResponse.json({ iban: null });
    }

    return NextResponse.json({ iban: banks[0].acc_number || null, bankName: banks[0].bank_id ? banks[0].bank_id[1] : null });
  } catch (err: unknown) {
    console.error('GET /api/hr/bank error:', err);
    return NextResponse.json({ error: 'Failed to fetch bank info' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { iban } = await req.json();
    if (!iban || typeof iban !== 'string') {
      return NextResponse.json({ error: 'IBAN is required' }, { status: 400 });
    }

    const cleaned = iban.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) {
      return NextResponse.json({ error: 'Invalid IBAN format' }, { status: 400 });
    }

    const odoo = getOdoo();
    const emps = await odoo.searchRead('hr.employee', [['id', '=', user.employee_id]], ['bank_account_id', 'address_home_id'], { limit: 1 });
    if (!emps.length) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    const emp = emps[0];
    const partnerId = emp.address_home_id ? emp.address_home_id[0] : null;

    if (emp.bank_account_id) {
      const bankId = emp.bank_account_id[0];
      await odoo.write('res.partner.bank', [bankId], { acc_number: cleaned });
    } else if (partnerId) {
      const newBankId = await odoo.create('res.partner.bank', { acc_number: cleaned, partner_id: partnerId });
      await odoo.write('hr.employee', [user.employee_id], { bank_account_id: newBankId });
    } else {
      return NextResponse.json({ error: 'Employee has no private address. Ask your manager to set it up.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, iban: cleaned });
  } catch (err: unknown) {
    console.error('POST /api/hr/bank error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save bank info' }, { status: 500 });
  }
}

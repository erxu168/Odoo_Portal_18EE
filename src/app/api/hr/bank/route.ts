import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { parseCompanyIds } from '@/lib/db';

/**
 * Resolve the target employee for a bank read/write.
 * - No employee_id => the logged-in user's own record (self-service).
 * - employee_id given => manager/admin editing someone else; requires manager
 *   role and (for non-admins) the target's company in the allowed set.
 * Returns { targetId } or { error }.
 */
async function resolveTarget(odoo: ReturnType<typeof getOdoo>, employeeIdRaw: unknown) {
  const user = getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };

  const requested = employeeIdRaw ? Number(employeeIdRaw) : 0;
  const isOther = requested && requested !== user.employee_id;

  if (isOther) {
    if (!hasRole(user, 'manager')) {
      return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };
    }
    if (user.role !== 'admin') {
      const emps = await odoo.searchRead('hr.employee', [['id', '=', requested]], ['company_id'], { limit: 1, context: { active_test: false } });
      if (!emps.length) return { error: NextResponse.json({ error: 'Employee not found' }, { status: 404 }) };
      const cId = Array.isArray(emps[0].company_id) ? emps[0].company_id[0] : null;
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (cId === null || !allowed.includes(cId)) {
        return { error: NextResponse.json({ error: 'You can only manage staff in your own restaurant.' }, { status: 403 }) };
      }
    }
    return { targetId: requested };
  }

  if (!user.employee_id) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  return { targetId: user.employee_id };
}

export async function GET(req: NextRequest) {
  try {
    const odoo = getOdoo();
    const employeeId = new URL(req.url).searchParams.get('employee_id');
    const scope = await resolveTarget(odoo, employeeId);
    if (scope.error) return scope.error;
    const targetId = scope.targetId!;

    const emps = await odoo.searchRead('hr.employee', [['id', '=', targetId]], ['bank_account_id'], { limit: 1, context: { active_test: false } });
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
    const { iban, employee_id } = await req.json();
    if (!iban || typeof iban !== 'string') {
      return NextResponse.json({ error: 'IBAN is required' }, { status: 400 });
    }

    const cleaned = iban.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) {
      return NextResponse.json({ error: 'Invalid IBAN format' }, { status: 400 });
    }

    const odoo = getOdoo();
    const scope = await resolveTarget(odoo, employee_id);
    if (scope.error) return scope.error;
    const targetId = scope.targetId!;

    // Odoo 18 removed hr.employee.address_home_id. A bank account (res.partner.bank)
    // now hangs off the employee's related partner, work_contact_id — which Odoo
    // auto-creates for every employee (verified: 0 employees lack one on staging).
    const emps = await odoo.searchRead('hr.employee', [['id', '=', targetId]], ['bank_account_id', 'work_contact_id'], { limit: 1, context: { active_test: false } });
    if (!emps.length) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    const emp = emps[0];
    const partnerId = emp.work_contact_id ? emp.work_contact_id[0] : null;

    if (emp.bank_account_id) {
      const bankId = emp.bank_account_id[0];
      await odoo.write('res.partner.bank', [bankId], { acc_number: cleaned });
    } else if (partnerId) {
      // res.partner.bank.create is unreachable via JSON-RPC on this instance: the
      // hr_payroll_account override of create() is missing @api.model_create_multi,
      // so Odoo's call_kw misreads the positional args and throws "missing 1 required
      // positional argument: 'vals_list'". Create the bank through the partner's
      // bank_ids one2many instead — an internal ORM create that isn't affected — then
      // link it to the employee.
      const before = await odoo.searchRead('res.partner.bank', [['partner_id', '=', partnerId]], ['id']);
      const beforeIds = new Set(before.map((b) => b.id));
      await odoo.write('res.partner', [partnerId], { bank_ids: [[0, 0, { acc_number: cleaned }]] });
      const after = await odoo.searchRead('res.partner.bank', [['partner_id', '=', partnerId]], ['id'], { order: 'id desc' });
      const created = after.find((b) => !beforeIds.has(b.id));
      if (!created) {
        return NextResponse.json({ error: 'Bank account could not be created in Odoo.' }, { status: 500 });
      }
      await odoo.write('hr.employee', [targetId], { bank_account_id: created.id });
    } else {
      return NextResponse.json({ error: 'This employee has no contact record in Odoo yet, so a bank account can’t be attached.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, iban: cleaned });
  } catch (err: unknown) {
    console.error('POST /api/hr/bank error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save bank info' }, { status: 500 });
  }
}

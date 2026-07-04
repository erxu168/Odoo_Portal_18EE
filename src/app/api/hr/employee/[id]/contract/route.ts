/**
 * GET  /api/hr/employee/[id]/contract — read the employee's current contract
 *   (+ picker options: contract types, working schedules). Pay fields are
 *   returned ONLY to admins.
 * PUT  /api/hr/employee/[id]/contract — upsert the employee's contract.
 *   Non-pay fields: managers + admins. Pay fields (wage_type/hourly_wage/wage):
 *   admins only — silently ignored for managers.
 *
 * Company-scoped: managers may only touch staff/contracts in their own restaurant(s).
 * Odoo model hr.contract (classic). Weekly hours live in custom
 * kw_agreed_weekly_hours / kw_working_days_per_week (NOT the computed hours_per_week).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

const CONTRACT_STATES = ['draft', 'open', 'close', 'cancel'];

function berlinToday(): string {
  // en-CA gives ISO-like YYYY-MM-DD; Berlin tz so date_start isn't off-by-one near midnight.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

async function loadEmployeeScoped(odoo: ReturnType<typeof getOdoo>, employeeId: number, fields: string[]) {
  const rows = await odoo.searchRead('hr.employee', [['id', '=', employeeId]], fields, {
    limit: 1, context: { active_test: false },
  });
  return rows && rows.length ? rows[0] : null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const employeeId = parseInt(params.id, 10);
    if (!employeeId) return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });

    const odoo = getOdoo();
    const emp = await loadEmployeeScoped(odoo, employeeId, ['name', 'company_id', 'contract_id', 'contract_ids']);
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const companyId = Array.isArray(emp.company_id) ? emp.company_id[0] : null;
    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed && (companyId === null || !allowed.includes(companyId))) {
      return NextResponse.json({ error: 'You can only manage staff in your own restaurant.' }, { status: 403 });
    }
    const isAdmin = user.role === 'admin';

    // The managed contract = the current (running) one, else the most recent of any state.
    let contractId = Array.isArray(emp.contract_id) ? emp.contract_id[0] : null;
    if (!contractId && Array.isArray(emp.contract_ids) && emp.contract_ids.length) {
      const recent = await odoo.searchRead('hr.contract', [['id', 'in', emp.contract_ids]], ['id'], {
        order: 'date_start desc, id desc', limit: 1, context: { active_test: false },
      });
      contractId = recent.length ? recent[0].id : null;
    }

    let contract: Record<string, unknown> | null = null;
    if (contractId) {
      const fields = ['id', 'name', 'date_start', 'date_end', 'state', 'contract_type_id',
        'resource_calendar_id', 'kw_agreed_weekly_hours', 'kw_working_days_per_week'];
      if (isAdmin) fields.push('wage_type', 'hourly_wage', 'wage');
      const rows = await odoo.searchRead('hr.contract', [['id', '=', contractId]], fields, {
        limit: 1, context: { active_test: false },
      });
      if (rows.length) {
        const c = rows[0];
        contract = {
          id: c.id,
          name: c.name,
          date_start: c.date_start || '',
          date_end: c.date_end || '',
          state: c.state || 'draft',
          contract_type_id: Array.isArray(c.contract_type_id) ? c.contract_type_id[0] : null,
          resource_calendar_id: Array.isArray(c.resource_calendar_id) ? c.resource_calendar_id[0] : null,
          weekly_hours: c.kw_agreed_weekly_hours || 0,
          days_per_week: c.kw_working_days_per_week || 0,
        };
        if (isAdmin) {
          contract.wage_type = c.wage_type || 'hourly';
          contract.hourly_wage = c.hourly_wage || 0;
          contract.wage = c.wage || 0;
        }
      }
    }

    const calendarDomain: unknown[] = companyId
      ? ['|', ['company_id', '=', companyId], ['company_id', '=', false]]
      : [];
    const [types, calendars] = await Promise.all([
      odoo.searchRead('hr.contract.type', [], ['id', 'name'], { order: 'id asc', limit: 50 }),
      odoo.searchRead('resource.calendar', calendarDomain, ['id', 'name'], { order: 'name asc', limit: 50 }),
    ]);

    return NextResponse.json({
      employee: {
        id: employeeId,
        name: emp.name,
        company_id: companyId,
        company_name: Array.isArray(emp.company_id) ? emp.company_id[1] : '',
      },
      contract,
      options: {
        contractTypes: (types || []).map((t: any) => ({ id: t.id, name: t.name })),
        calendars: (calendars || []).map((c: any) => ({ id: c.id, name: c.name })),
      },
      canEditPay: isAdmin,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/employee/[id]/contract error:', err);
    return NextResponse.json({ error: 'Failed to load contract' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const employeeId = parseInt(params.id, 10);
    if (!employeeId) return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });

    const body = await req.json();
    const odoo = getOdoo();

    const emp = await loadEmployeeScoped(odoo, employeeId, ['name', 'company_id']);
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    const companyId = Array.isArray(emp.company_id) ? emp.company_id[0] : null;

    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed && (companyId === null || !allowed.includes(companyId))) {
      return NextResponse.json({ error: 'You can only manage staff in your own restaurant.' }, { status: 403 });
    }
    const isAdmin = user.role === 'admin';

    // Non-pay fields (managers + admins).
    const vals: Record<string, unknown> = {};
    if (body.date_start) vals.date_start = String(body.date_start);
    if (body.date_end !== undefined) vals.date_end = body.date_end ? String(body.date_end) : false;
    if (body.contract_type_id !== undefined) {
      const n = Number(body.contract_type_id);
      vals.contract_type_id = Number.isInteger(n) && n > 0 ? n : false; // NaN/0/empty => clear, never NaN to Odoo
    }
    if (body.resource_calendar_id !== undefined) {
      const n = Number(body.resource_calendar_id);
      vals.resource_calendar_id = Number.isInteger(n) && n > 0 ? n : false;
    }
    if (body.weekly_hours !== undefined) vals.kw_agreed_weekly_hours = Number(body.weekly_hours) || 0;
    if (body.days_per_week !== undefined) vals.kw_working_days_per_week = Number(body.days_per_week) || 0;
    if (body.state && CONTRACT_STATES.includes(body.state)) vals.state = body.state;

    // Pay fields — admins ONLY. Managers' pay values are ignored.
    if (isAdmin) {
      if (body.wage_type && ['monthly', 'hourly'].includes(body.wage_type)) vals.wage_type = body.wage_type;
      if (body.hourly_wage !== undefined) vals.hourly_wage = Number(body.hourly_wage) || 0;
      if (body.wage !== undefined) vals.wage = Number(body.wage) || 0;
    }

    const contractId = body.contract_id ? Number(body.contract_id) : null;

    if (contractId) {
      // Update — verify the contract belongs to this employee and its company is in scope.
      const rows = await odoo.searchRead('hr.contract', [['id', '=', contractId]], ['employee_id', 'company_id'], {
        limit: 1, context: { active_test: false },
      });
      if (!rows.length) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
      const cEmp = Array.isArray(rows[0].employee_id) ? rows[0].employee_id[0] : null;
      const cCompany = Array.isArray(rows[0].company_id) ? rows[0].company_id[0] : null;
      if (cEmp !== employeeId) {
        return NextResponse.json({ error: 'That contract does not belong to this employee.' }, { status: 403 });
      }
      if (allowed && (cCompany === null || !allowed.includes(cCompany))) {
        return NextResponse.json({ error: 'You can only manage contracts in your own restaurant.' }, { status: 403 });
      }
      if (Object.keys(vals).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
      await odoo.write('hr.contract', [contractId], vals);
      return NextResponse.json({ success: true, contract_id: contractId });
    }

    // No client-supplied contract id → create. But first guard two edge cases:
    // (a) an employee with no restaurant (Odoo's required company_id would reject a null), and
    // (b) a stale/racing client that would spawn a SECOND running contract — merge into the
    //     real current one instead of duplicating (employee.contract_id must stay unambiguous).
    if (companyId === null) {
      return NextResponse.json({ error: 'This employee has no restaurant assigned. Assign one first, then add a contract.' }, { status: 400 });
    }
    const existingOpen = await odoo.searchRead(
      'hr.contract', [['employee_id', '=', employeeId], ['state', '=', 'open']], ['id'],
      { limit: 1, context: { active_test: false } },
    );
    if (existingOpen.length) {
      if (Object.keys(vals).length > 0) await odoo.write('hr.contract', [existingOpen[0].id], vals);
      return NextResponse.json({ success: true, contract_id: existingOpen[0].id });
    }

    // Create — hr.contract requires name (no default), date_start, wage, company_id.
    const dateStart = (vals.date_start as string) || berlinToday();
    const createVals: Record<string, unknown> = {
      ...vals,
      name: `${emp.name} - ${dateStart}`,
      employee_id: employeeId,
      company_id: companyId,
      date_start: dateStart,
    };
    if (createVals.wage === undefined) createVals.wage = 0.0; // required; hourly staff carry 0 here
    if (!createVals.state) createVals.state = 'open';         // make it the current/running contract
    const newId = await odoo.create('hr.contract', createVals);
    return NextResponse.json({ success: true, contract_id: newId }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('PUT /api/hr/employee/[id]/contract error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save contract' }, { status: 500 });
  }
}

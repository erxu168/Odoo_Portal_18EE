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

const CONTRACT_FIELDS_BASE = ['id', 'name', 'date_start', 'date_end', 'state',
  'contract_type_id', 'resource_calendar_id', 'kw_agreed_weekly_hours', 'kw_working_days_per_week'];
const CONTRACT_FIELDS_PAY = ['wage_type', 'hourly_wage', 'wage'];

function berlinToday(): string {
  // en-CA gives ISO-like YYYY-MM-DD; Berlin tz so date_start isn't off-by-one near midnight.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

// One day before an ISO date (YYYY-MM-DD). Noon-UTC anchor avoids tz/DST rollover.
function dayBefore(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Shape one hr.contract row into the flat form model the portal screen uses.
// Pay fields are only included when the caller is an admin.
function mapContract(c: Record<string, any>, isAdmin: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
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
    out.wage_type = c.wage_type || 'hourly';
    out.hourly_wage = c.hourly_wage || 0;
    out.wage = c.wage || 0;
  }
  return out;
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
    const emp = await loadEmployeeScoped(odoo, employeeId, ['name', 'company_id', 'contract_id']);
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const companyId = Array.isArray(emp.company_id) ? emp.company_id[0] : null;
    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed && (companyId === null || !allowed.includes(companyId))) {
      return NextResponse.json({ error: 'You can only manage staff in your own restaurant.' }, { status: 403 });
    }
    const isAdmin = user.role === 'admin';

    // Every contract this employee has ever had (newest first) — powers the history list.
    const fields = isAdmin ? [...CONTRACT_FIELDS_BASE, ...CONTRACT_FIELDS_PAY] : [...CONTRACT_FIELDS_BASE];
    const rows = await odoo.searchRead('hr.contract', [['employee_id', '=', employeeId]], fields, {
      order: 'date_start desc, id desc', context: { active_test: false },
    });
    const contracts = (rows || []).map((c: any) => mapContract(c, isAdmin));

    // The contract shown in the form by default = the running one, else the most recent.
    const currentId = Array.isArray(emp.contract_id) ? emp.contract_id[0] : null;
    const contract = contracts.find((c) => c.id === currentId) || contracts[0] || null;

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
      contracts,
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

/**
 * POST /api/hr/employee/[id]/contract — "start a new contract" (renewal).
 * Ends the employee's current running contract (kept as history) and creates a NEW
 * contract, pre-filled from the body. Old and new never overlap. This is deliberately
 * a separate action from PUT so it bypasses PUT's "merge into the open contract" guard —
 * the whole point here is to create a second record, not overwrite the first.
 *
 * Non-pay fields: managers + admins. Pay: admins may set it from the form; for managers
 * it is carried forward from the old contract (they cannot edit pay themselves).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
    if (companyId === null) {
      return NextResponse.json({ error: 'This employee has no restaurant assigned. Assign one first, then add a contract.' }, { status: 400 });
    }
    const isAdmin = user.role === 'admin';

    // The contract we renew FROM: the running one, else the most recent of any state.
    // Read pay too, so it can carry forward for managers.
    const readFields = ['id', 'date_end', 'wage_type', 'hourly_wage', 'wage'];
    const openRows = await odoo.searchRead(
      'hr.contract', [['employee_id', '=', employeeId], ['state', '=', 'open']], readFields,
      { order: 'date_start desc, id desc', limit: 1, context: { active_test: false } },
    );
    let current = openRows.length ? openRows[0] : null;
    if (!current) {
      const recent = await odoo.searchRead(
        'hr.contract', [['employee_id', '=', employeeId]], readFields,
        { order: 'date_start desc, id desc', limit: 1, context: { active_test: false } },
      );
      current = recent.length ? recent[0] : null;
    }

    const newStart = body.date_start ? String(body.date_start) : berlinToday();

    // New contract's non-pay values.
    const vals: Record<string, unknown> = {};
    if (body.date_end !== undefined) vals.date_end = body.date_end ? String(body.date_end) : false;
    if (body.contract_type_id !== undefined) {
      const n = Number(body.contract_type_id);
      vals.contract_type_id = Number.isInteger(n) && n > 0 ? n : false;
    }
    if (body.resource_calendar_id !== undefined) {
      const n = Number(body.resource_calendar_id);
      vals.resource_calendar_id = Number.isInteger(n) && n > 0 ? n : false;
    }
    if (body.weekly_hours !== undefined) vals.kw_agreed_weekly_hours = Number(body.weekly_hours) || 0;
    if (body.days_per_week !== undefined) vals.kw_working_days_per_week = Number(body.days_per_week) || 0;

    // Pay: admins set it from the form; everyone else carries it forward from the old contract.
    const adminSetPay = isAdmin && (body.wage_type !== undefined || body.hourly_wage !== undefined || body.wage !== undefined);
    if (adminSetPay) {
      if (body.wage_type && ['monthly', 'hourly'].includes(body.wage_type)) vals.wage_type = body.wage_type;
      vals.hourly_wage = Number(body.hourly_wage) || 0;
      vals.wage = Number(body.wage) || 0;
    } else if (current) {
      vals.wage_type = current.wage_type || 'hourly';
      vals.hourly_wage = current.hourly_wage || 0;
      vals.wage = current.wage || 0;
    }

    // End the current running contract (kept as history), closing its end date so the
    // two periods don't overlap.
    if (openRows.length) {
      const endDate = openRows[0].date_end || dayBefore(newStart);
      await odoo.write('hr.contract', [openRows[0].id], { state: 'close', date_end: endDate });
    }

    // Create the new contract, pre-filled from the old one.
    const newState = body.state && CONTRACT_STATES.includes(body.state) ? body.state : 'open';
    const createVals: Record<string, unknown> = {
      ...vals,
      name: `${emp.name} - ${newStart}`,
      employee_id: employeeId,
      company_id: companyId,
      date_start: newStart,
      state: newState,
    };
    if (createVals.wage === undefined) createVals.wage = 0.0;
    const newId = await odoo.create('hr.contract', createVals);
    return NextResponse.json({ success: true, contract_id: newId }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/employee/[id]/contract error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to start new contract' }, { status: 500 });
  }
}

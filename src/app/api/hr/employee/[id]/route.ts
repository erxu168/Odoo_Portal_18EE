/**
 * GET   /api/hr/employee/[id] — read a staff member's full record (manager/admin).
 * PATCH /api/hr/employee/[id] — edit the essentials AND the full DATEV record,
 *   plus deactivate/reactivate (active flag).
 * Company-scoped: managers may only touch their own restaurant(s).
 * Separate from /api/hr/employee (self-service) — do not merge the allowlists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { EMPLOYEE_READ_FIELDS } from '@/types/hr';

// Essentials — coerced (company/department -> number, active -> boolean).
const BASICS = new Set(['name', 'company_id', 'department_id', 'job_title', 'work_email', 'mobile_phone', 'active']);

// Full DATEV record — passed through as-is (the edit form sends correct types,
// incl. `false` for cleared values). Mirrors the self-service WRITABLE set.
const DATEV = new Set([
  'nick_name', 'birthday', 'gender', 'marital', 'country_id', 'place_of_birth',
  'country_of_birth', 'children', 'disabled', 'kw_geburtsname',
  'private_street', 'private_street2', 'private_zip', 'private_city',
  'private_country_id', 'private_email', 'private_phone',
  'emergency_contact', 'emergency_phone', 'kw_emergency_relation',
  'identification_id', 'kw_steuer_id', 'kw_steuerklasse', 'kw_konfession', 'kw_kinderfreibetrag',
  'ssnid', 'kw_krankenkasse_name', 'kw_kv_typ',
  'kw_beschaeftigungsbeginn', 'kw_wochenarbeitszeit', 'kw_taetigkeit_ba',
  'kw_befristung', 'kw_befristung_bis', 'kw_probezeit_bis',
  'kw_aufenthaltstitel_typ', 'passport_id', 'visa_no', 'permit_no',
  'visa_expire', 'work_permit_expiration_date',
  'kw_gesundheitszeugnis_datum', 'kw_gesundheitszeugnis_ablauf',
  'kw_sofortmeldung_done', 'kw_sofortmeldung_datum',
]);

// Resolve the employee's company + enforce manager scoping. Returns the company
// id, or a NextResponse to return early (404/403).
async function scopeEmployee(odoo: ReturnType<typeof getOdoo>, employeeId: number, user: { role: string; allowed_company_ids: string }) {
  const existing = await odoo.searchRead(
    'hr.employee', [['id', '=', employeeId]], ['company_id'],
    { limit: 1, context: { active_test: false } },
  );
  if (!existing || existing.length === 0) {
    return { error: NextResponse.json({ error: 'Employee not found' }, { status: 404 }) };
  }
  const companyId = Array.isArray(existing[0].company_id) ? existing[0].company_id[0] : null;
  const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
  if (allowed && (companyId === null || !allowed.includes(companyId))) {
    return { error: NextResponse.json({ error: 'You can only manage staff in your own restaurant.' }, { status: 403 }) };
  }
  return { companyId, allowed };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const employeeId = parseInt(params.id, 10);
    if (!employeeId) return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });

    const odoo = getOdoo();
    const scope = await scopeEmployee(odoo, employeeId, user);
    if (scope.error) return scope.error;

    const rows = await odoo.searchRead('hr.employee', [['id', '=', employeeId]], EMPLOYEE_READ_FIELDS, {
      limit: 1, context: { active_test: false },
    });
    if (!rows.length) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    return NextResponse.json({ employee: rows[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/employee/[id] error:', err);
    return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const employeeId = parseInt(params.id, 10);
    if (!employeeId) return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });

    const body = await req.json();
    const odoo = getOdoo();

    const scope = await scopeEmployee(odoo, employeeId, user);
    if (scope.error) return scope.error;
    const allowed = scope.allowed;

    const vals: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (BASICS.has(k)) {
        if (k === 'company_id' || k === 'department_id') vals[k] = Number(v);
        else if (k === 'active') vals[k] = Boolean(v);
        else vals[k] = typeof v === 'string' ? v.trim() : v;
      } else if (DATEV.has(k)) {
        vals[k] = v; // pass through (correct types + false-for-empty from the form)
      }
    }
    if (Object.keys(vals).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }
    if (vals.name !== undefined && !String(vals.name).trim()) {
      return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
    }
    // Moving to another restaurant requires the manager to own the target too.
    if (allowed && vals.company_id !== undefined && !allowed.includes(Number(vals.company_id))) {
      return NextResponse.json({ error: 'You can only assign staff to your own restaurant.' }, { status: 403 });
    }

    await odoo.write('hr.employee', [employeeId], vals);
    return NextResponse.json({ success: true, updated: Object.keys(vals) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('PATCH /api/hr/employee/[id] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update employee' }, { status: 500 });
  }
}

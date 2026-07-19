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
import { parseCompanyIds, setUserEmail, getUserByEmployeeId } from '@/lib/db';
import { EMPLOYEE_READ_FIELDS } from '@/types/hr';

// Essentials — coerced (company/department -> number, active -> boolean).
// work_phone is deliberately NOT here — it is written separately (see PATCH) so an
// in-request company change can't let Odoo's stored recompute overwrite the value.
const BASICS = new Set(['name', 'company_id', 'department_id', 'job_title', 'work_email', 'mobile_phone', 'active']);

// Full DATEV record — passed through as-is (the edit form sends correct types,
// incl. `false` for cleared values). Mirrors the self-service WRITABLE set.
const DATEV = new Set([
  'nick_name', 'birthday', 'gender', 'marital', 'country_id', 'place_of_birth',
  'country_of_birth', 'children', 'disabled', 'is_university_student', 'kw_geburtsname',
  'private_street', 'private_street2', 'private_zip', 'private_city',
  'private_country_id', 'private_email', 'private_phone',
  'emergency_contact', 'emergency_phone', 'kw_emergency_relation',
  'identification_id', 'kw_steuer_id', 'kw_steuerklasse', 'kw_konfession', 'kw_kinderfreibetrag',
  'ssnid', 'kw_krankenkasse_name', 'kw_kv_typ',
  'kw_beschaeftigungsbeginn', 'kw_wochenarbeitszeit', 'kw_taetigkeit_ba',
  'kw_befristung', 'kw_befristung_bis', 'kw_probezeit_bis',
  'kw_aufenthaltstitel_typ', 'kw_aufenthaltstitel_paragraph', 'passport_id', 'visa_no', 'permit_no',
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

    // work_phone: pull it out of the main write. Standard Odoo recomputes work_phone
    // from the work address (company) whenever company_id / the work address changes,
    // so writing it in the SAME dict as a company move could let that recompute clobber
    // the entered value. Write it separately and last. Empty -> false to clear (same
    // sentinel the create path uses), so blank stays blank.
    const hasWorkPhone = Object.prototype.hasOwnProperty.call(body, 'work_phone');
    const workPhone = hasWorkPhone ? (String(body.work_phone || '').trim() || false) : undefined;

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
    if (Object.keys(vals).length === 0 && !hasWorkPhone) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }
    if (vals.name !== undefined && !String(vals.name).trim()) {
      return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
    }
    // Moving to another restaurant requires the manager to own the target too.
    if (allowed && vals.company_id !== undefined && !allowed.includes(Number(vals.company_id))) {
      return NextResponse.json({ error: 'You can only assign staff to your own restaurant.' }, { status: 403 });
    }

    if (Object.keys(vals).length > 0) {
      await odoo.write('hr.employee', [employeeId], vals);
    }
    // Profile Work email is the single source of truth — keep the linked portal login email
    // in sync. Best-effort: a failure/collision never fails the profile save.
    let emailSync: string | undefined;
    if (vals.work_email !== undefined) {
      // SECURITY: changing the login email is a credential change. Resolve the linked account ONCE,
      // then check its role AND update THAT SAME row — so a non-admin can never re-point an ADMIN
      // account's email (that + the public password-reset flow = account takeover), even if duplicate
      // links exist. Mirrors the "only admins may touch admin accounts" rule.
      const linked = getUserByEmployeeId(employeeId);
      if (!linked) {
        emailSync = 'no_user';
      } else if (linked.role === 'admin' && user.role !== 'admin') {
        emailSync = 'skipped_admin_target';
      } else {
        try {
          emailSync = setUserEmail(linked.id, String(vals.work_email || ''));
        } catch (e) {
          console.error('[email-sync] failed for employee', employeeId, e);
          emailSync = 'error';
        }
      }
    }
    // Separate, final write so a same-request company change can't recompute over it.
    if (hasWorkPhone) {
      await odoo.write('hr.employee', [employeeId], { work_phone: workPhone });
    }
    const updated = [...Object.keys(vals), ...(hasWorkPhone ? ['work_phone'] : [])];
    return NextResponse.json({ success: true, updated, emailSync });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('PATCH /api/hr/employee/[id] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update employee' }, { status: 500 });
  }
}

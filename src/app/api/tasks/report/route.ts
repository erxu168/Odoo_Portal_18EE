import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { accountability, accountabilityDetail } from '@/lib/task-review';
import { userCompanyAllowed } from '@/lib/company-scope';
import { isCanonicalDay } from '@/lib/berlin-date';
import { moduleForbidden } from '@/lib/module-access';

/**
 * GET — who completed what, over a date range. READ ONLY; writes nothing.
 *
 * ?company_id=6&from=2026-08-01&to=2026-08-07[&department_id=3][&employee_id=5]
 * With employee_id it returns that person's individual tasks instead of the
 * summary.
 */
export const dynamic = 'force-dynamic';

/** A whole year of daily lists is already a lot of rows; beyond that this stops
 *  being a report anyone reads and starts being a database export. */
const MAX_DAYS = 366;

export async function GET(req: NextRequest) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireCapability('tasks.manager.view');
    const q = new URL(req.url).searchParams;

    const companyId = parseInt(q.get('company_id') || '', 10);
    const from = q.get('from') || '';
    const to = q.get('to') || '';
    if (Number.isNaN(companyId)) return NextResponse.json({ error: 'company_id required' }, { status: 400 });
    // isCanonicalDay, not a digit-shaped regex: "2026-02-31" satisfies the shape,
    // parses to NaN, and made the range cap below a no-op that let an
    // unvalidated string reach the database.
    if (!isCanonicalDay(from) || !isCanonicalDay(to)) {
      return NextResponse.json({ error: 'from and to must be real dates (YYYY-MM-DD)' }, { status: 400 });
    }
    if (from > to) return NextResponse.json({ error: 'The start date is after the end date.' }, { status: 400 });
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (!Number.isFinite(days) || days > MAX_DAYS) {
      return NextResponse.json({ error: 'Choose a range of a year or less.' }, { status: 400 });
    }

    // The same gate every other screen uses — which treats an admin as
    // unrestricted. Reading the raw allowed list instead made the report 404
    // for the one admin account, whose list is empty precisely BECAUSE it is
    // unrestricted. Odoo is then given the single company that was authorised,
    // so its own fail-closed check agrees with this one instead of contradicting it.
    if (!userCompanyAllowed(user, companyId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const allowed = [companyId];

    const employeeId = q.get('employee_id');
    if (employeeId) {
      const eid = parseInt(employeeId, 10);
      if (Number.isNaN(eid)) return NextResponse.json({ error: 'Invalid employee_id' }, { status: 400 });
      const detail = await accountabilityDetail(companyId, eid, from, to, allowed);
      return NextResponse.json({ ok: true, ...detail });
    }

    const deptRaw = q.get('department_id');
    const departmentId = deptRaw ? parseInt(deptRaw, 10) : null;
    if (deptRaw && Number.isNaN(departmentId as number)) {
      return NextResponse.json({ error: 'Invalid department_id' }, { status: 400 });
    }

    const data = await accountability(companyId, from, to, departmentId, allowed);
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET report error:', err);
    return NextResponse.json({ error: 'Could not build the report' }, { status: 500 });
  }
}

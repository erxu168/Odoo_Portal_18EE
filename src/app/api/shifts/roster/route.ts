/**
 * GET /api/shifts/roster?company_id= — roster & caps list for managers.
 *
 * Employees with caps, skill levels and "Can work as" roles resolved, plus the
 * company's planning roles for the edit sheet's role chips.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchDepartments, fetchEmployees, fetchRoles, monthHoursMap } from '@/lib/shifts-odoo';
import { employeesWithPin } from '@/lib/shifts-db';
import { requireManagerCompany, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const [employees, roles, departments, monthHours] = await Promise.all([
      fetchEmployees(companyId),
      fetchRoles(companyId),
      fetchDepartments(companyId),
      monthHoursMap(companyId),
    ]);
    const pinnedEmployeeIds = Array.from(employeesWithPin(companyId));
    const monthHoursByEmployee = Object.fromEntries(monthHours);

    return NextResponse.json({ employees, roles, departments, pinnedEmployeeIds, monthHoursByEmployee });
  } catch (err: unknown) {
    return serverError('GET roster', err);
  }
}

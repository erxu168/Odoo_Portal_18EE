import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/hr/filters
 * Returns companies and departments from Odoo for employee filtering.
 * Only returns departments that have at least one active employee.
 */
export async function GET() {
  try {
    const user = getCurrentUser();
    if (!user || !hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
    }

    const odoo = getOdoo();

    const [companies, departments, employees] = await Promise.all([
      odoo.searchRead('res.company', [], ['id', 'name'], { limit: 50, order: 'name asc' }),
      odoo.searchRead('hr.department', [['active', '=', true]], ['id', 'name', 'company_id'], { limit: 200, order: 'name asc' }),
      odoo.searchRead('hr.employee', [['active', '=', true]], ['department_id'], { limit: 5000 }),
    ]);

    // Count employees per department
    const deptCounts: Record<number, number> = {};
    for (const emp of (employees || [])) {
      if (emp.department_id) {
        const dId = emp.department_id[0];
        deptCounts[dId] = (deptCounts[dId] || 0) + 1;
      }
    }

    // Only include departments with at least 1 employee
    const activeDepts = (departments || []).filter((d: any) => (deptCounts[d.id] || 0) > 0);

    return NextResponse.json({
      companies: (companies || []).map((c: any) => ({ id: c.id, name: c.name })),
      departments: activeDepts.map((d: any) => ({
        id: d.id,
        name: d.name,
        company_id: d.company_id ? d.company_id[0] : null,
        employee_count: deptCounts[d.id] || 0,
      })),
    });
  } catch (err: unknown) {
    console.error('GET /api/hr/filters error:', err);
    return NextResponse.json({ error: 'Failed to fetch filters' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/hr/filters
 * Returns companies and departments from Odoo for employee filtering.
 * Departments are returned with their company_id so the frontend can filter them.
 */
export async function GET() {
  try {
    const user = getCurrentUser();
    if (!user || !hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
    }

    const odoo = getOdoo();

    const [companies, departments] = await Promise.all([
      odoo.searchRead('res.company', [], ['id', 'name'], { limit: 50, order: 'name asc' }),
      odoo.searchRead('hr.department', [['active', '=', true]], ['id', 'name', 'company_id'], { limit: 200, order: 'name asc' }),
    ]);

    return NextResponse.json({
      companies: (companies || []).map((c: any) => ({ id: c.id, name: c.name })),
      departments: (departments || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        company_id: d.company_id ? d.company_id[0] : null,
      })),
    });
  } catch (err: unknown) {
    console.error('GET /api/hr/filters error:', err);
    return NextResponse.json({ error: 'Failed to fetch filters' }, { status: 500 });
  }
}

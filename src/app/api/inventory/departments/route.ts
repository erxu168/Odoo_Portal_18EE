/**
 * GET /api/inventory/departments
 *
 * Proxies hr.department from Odoo 18 EE.
 * Returns departments with active members.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { companyScope } from '@/lib/inventory-access';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    // Company scope: managers/restricted admins see only their restaurants'
    // departments (excludes shared/no-company ones, matching other HR endpoints);
    // an unrestricted admin (undefined scope) sees all.
    const scope = companyScope(user);
    if (scope && scope.length === 0) return NextResponse.json({ departments: [] });
    const domain = scope ? [['company_id', 'in', scope]] : [];
    const departments = await odoo.searchRead('hr.department', domain,
      ['id', 'name', 'member_ids'],
      { order: 'name' }
    );

    // Filter to departments with at least 1 member
    const active = departments.filter((d: any) => d.member_ids && d.member_ids.length > 0)
      .map((d: any) => ({ id: d.id, name: d.name, member_count: d.member_ids.length }));

    return NextResponse.json({ departments: active });
  } catch (err: any) {
    console.error('Departments error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

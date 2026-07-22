/**
 * GET /api/inventory/departments
 *
 * Proxies hr.department from Odoo 18 EE.
 * Returns departments with active members.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { canAccessCompany, companyScope } from '@/lib/inventory-access';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    // The company selector (blue-ribbon) is the SOURCE OF TRUTH: filter to the
    // ACTIVE company (?company_id= or the kw_company_id cookie), bounded by the
    // caller's allowed companies — so selecting "What a Jerk" never shows another
    // restaurant's departments. Only when no company is selected do we fall back
    // to the caller's full allowed scope (unrestricted admin = all).
    const { searchParams } = new URL(request.url);
    const active = parseInt(searchParams.get('company_id') || '0', 10)
      || parseInt(cookies().get('kw_company_id')?.value || '0', 10);
    let domain: unknown[] = [];
    if (active && canAccessCompany(user, active)) {
      domain = [['company_id', '=', active]];
    } else {
      const scope = companyScope(user);
      if (scope && scope.length === 0) return NextResponse.json({ departments: [] });
      domain = scope ? [['company_id', 'in', scope]] : [];
    }
    const departments = await odoo.searchRead('hr.department', domain,
      ['id', 'name', 'member_ids'],
      { order: 'name' }
    );

    // Return ALL departments (incl. zero-member ones) so a department created
    // inline from the list builder is immediately selectable — filtering by
    // member count would hide a brand-new department and break quick-create.
    const withCount = departments.map((d: any) => ({
      id: d.id,
      name: d.name,
      member_count: Array.isArray(d.member_ids) ? d.member_ids.length : 0,
    }));

    return NextResponse.json({ departments: withCount });
  } catch (err: any) {
    console.error('Departments error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

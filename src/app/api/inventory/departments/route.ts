/**
 * GET /api/inventory/departments
 *
 * Proxies hr.department from Odoo 18 EE.
 * Returns departments with active members.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    const departments = await odoo.searchRead('hr.department', [],
      ['id', 'name', 'member_ids'],
      { order: 'name' }
    );

    // Filter to departments with at least 1 member
    const active = departments.filter((d: any) => d.member_ids && d.member_ids.length > 0)
      .map((d: any) => ({ id: d.id, name: d.name, member_count: d.member_ids.length }));

    return NextResponse.json({ departments: active });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Departments error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { OdooClient } from '@/lib/odoo';
import { EMPLOYEE_READ_FIELDS } from '@/types/hr';

export async function GET(req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const filter = searchParams.get('filter') || 'all';

    const domain: unknown[][] = [['active', '=', true]];
    if (search) {
      domain.push(['name', 'ilike', search]);
    }
    if (filter === 'incomplete') {
      domain.push(['kw_onboarding_status', '!=', 'complete']);
    } else if (filter === 'expiring') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 90);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      domain.push(['visa_expire', '<=', cutoffStr]);
      domain.push(['visa_expire', '!=', false]);
    }

    const employees = await odoo.searchRead(
      'hr.employee', domain, EMPLOYEE_READ_FIELDS,
    );

    return NextResponse.json({ employees: employees || [] });
  } catch (err: unknown) {
    console.error('GET /api/hr/employees error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch employees' },
      { status: 500 }
    );
  }
}

/**
 * Staff Lifecycle Checklists — company-scoped assignee picker for the template editor.
 * GET /api/staffing/assignees?company_id=  → active portal users assignable in that company.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { listUsers } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const companyId = Number(new URL(req.url).searchParams.get('company_id'));
    if (!companyId) return NextResponse.json({ error: 'company_id required' }, { status: 400 });
    if (!canAccessCompany(user, companyId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const assignees = listUsers()
      .filter(u => u.active && u.status === 'active' && !u.is_shared_device)
      .filter(u => canAccessCompany(u, companyId)) // same rule as authorization (no empty-list god-mode)
      .map(u => ({ id: u.id, name: u.name, role: u.role, employee_id: u.employee_id }));

    return NextResponse.json({ assignees });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET assignees', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

/**
 * PATCH /api/hr/employee/[id]
 * Manager/admin edit of a staff member's essentials, plus deactivate/reactivate
 * (active flag). Company-scoped: managers may only touch their own restaurant(s).
 * Separate from /api/hr/employee (self-service) — do not merge the allowlists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

const EDITABLE = new Set(['name', 'company_id', 'department_id', 'job_title', 'work_email', 'mobile_phone', 'active']);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const employeeId = parseInt(params.id, 10);
    if (!employeeId) return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });

    const body = await req.json();
    const odoo = getOdoo();

    // Load current company (for scoping). active_test:false so archived staff can be reactivated.
    const existing = await odoo.searchRead(
      'hr.employee', [['id', '=', employeeId]], ['company_id'],
      { limit: 1, context: { active_test: false } },
    );
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    const currentCompanyId = Array.isArray(existing[0].company_id) ? existing[0].company_id[0] : null;

    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed && (currentCompanyId === null || !allowed.includes(currentCompanyId))) {
      return NextResponse.json({ error: 'You can only manage staff in your own restaurant.' }, { status: 403 });
    }

    const vals: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!EDITABLE.has(k)) continue;
      if (k === 'company_id' || k === 'department_id') vals[k] = Number(v);
      else if (k === 'active') vals[k] = Boolean(v);
      else vals[k] = typeof v === 'string' ? v.trim() : v;
    }
    if (Object.keys(vals).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }
    if (vals.name !== undefined && !String(vals.name).trim()) {
      return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
    }
    // Moving to another restaurant requires the manager to own the target too.
    if (allowed && vals.company_id !== undefined && !allowed.includes(Number(vals.company_id))) {
      return NextResponse.json({ error: 'You can only assign staff to your own restaurant.' }, { status: 403 });
    }

    await odoo.write('hr.employee', [employeeId], vals);
    return NextResponse.json({ success: true, updated: Object.keys(vals) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('PATCH /api/hr/employee/[id] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update employee' }, { status: 500 });
  }
}

/**
 * PATCH /api/hr/job/[id]
 * Manager/admin edit of a job position / role, plus archive/restore (active flag).
 * Company-scoped: managers may only touch roles in their own restaurant(s); legacy
 * global (company-less) roles are admin-only. No DELETE — removal is archiving.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

const EDITABLE = new Set(['name', 'company_id', 'department_id', 'active']);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const id = parseInt(params.id, 10);
    if (!id) return NextResponse.json({ error: 'Invalid role id' }, { status: 400 });

    const body = await req.json();
    const odoo = getOdoo();

    // Load current company (for scoping). active_test:false so archived roles can be restored.
    const existing = await odoo.searchRead(
      'hr.job', [['id', '=', id]], ['company_id'],
      { limit: 1, context: { active_test: false } },
    );
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    const currentCompanyId = Array.isArray(existing[0].company_id) ? existing[0].company_id[0] : null;

    // Managers: role must belong to one of their restaurants (global roles are admin-only).
    const allowed = user.role === 'admin' ? null : parseCompanyIds(user.allowed_company_ids);
    if (allowed && (currentCompanyId === null || !allowed.includes(currentCompanyId))) {
      return NextResponse.json({ error: 'You can only manage roles in your own restaurant.' }, { status: 403 });
    }

    const vals: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!EDITABLE.has(k)) continue;
      if (k === 'company_id') vals[k] = Number(v);
      else if (k === 'department_id') vals[k] = v ? Number(v) : false;
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
      return NextResponse.json({ error: 'You can only move a role to your own restaurant.' }, { status: 403 });
    }

    await odoo.write('hr.job', [id], vals);
    return NextResponse.json({ success: true, updated: Object.keys(vals) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('PATCH /api/hr/job/[id] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update role' }, { status: 500 });
  }
}

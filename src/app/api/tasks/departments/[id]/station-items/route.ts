import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getDepartmentCompany } from '@/lib/odoo-tasks';
import { listStationItems, addStationItem } from '@/lib/setup-guide';

/** Fail closed: the department's company must be within the user's allowed set.
 * An empty allowed set means "all companies" (admin), matching the rest of the module. */
async function assertDeptAllowed(deptId: number, allowed: number[]): Promise<void> {
  const company = await getDepartmentCompany(deptId);
  if (company === null) throw new AuthError('Department not found', 404);
  if (allowed.length && !allowed.includes(company)) throw new AuthError('Forbidden', 403);
}

// GET — list active catalog items for a department (any authenticated user in-company).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireAuth();
    const deptId = parseInt(params.id, 10);
    if (Number.isNaN(deptId)) return NextResponse.json({ error: 'Invalid department id' }, { status: 400 });
    await assertDeptAllowed(deptId, parseCompanyIds(user.allowed_company_ids));
    const items = await listStationItems(deptId);
    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to list items';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — add (or reactivate) a catalog item. Manager/admin only, company-scoped.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('tasks.template.manage');
    const deptId = parseInt(params.id, 10);
    if (Number.isNaN(deptId)) return NextResponse.json({ error: 'Invalid department id' }, { status: 400 });
    await assertDeptAllowed(deptId, parseCompanyIds(user.allowed_company_ids));
    const body = await req.json();
    const name = (body?.name || '').trim();
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const item = await addStationItem(deptId, name);
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to add item';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

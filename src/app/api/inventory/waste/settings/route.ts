export const dynamic = 'force-dynamic';
/**
 * /api/inventory/waste/settings — the per-department "photo required" switch.
 *
 * GET — every department's switch for the active restaurant (absent = off)
 * PUT — flip one department's switch. Managers only, and the department must
 *       belong to a restaurant the caller can access — checked against Odoo,
 *       because the department id arrives from the client.
 *
 * Off by default ON PURPOSE: a required photo is the single most likely reason
 * someone quietly stops recording, and that failure is silent.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { getPermissionOverrides } from '@/lib/db';
import { roleCan } from '@/lib/permissions';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, setWastePhotoRequired, wastePhotoRequiredByDepartment } from '@/lib/inventory-db';
import { isUnrestrictedAdmin, canAccessCompany } from '@/lib/inventory-access';
import { moduleForbidden } from '@/lib/module-access';

function activeCompany(searchParams: URLSearchParams): number {
  return parseInt(searchParams.get('company_id') || '0', 10)
    || parseInt(cookies().get('kw_company_id')?.value || '0', 10);
}

export async function GET(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.waste.settings', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const company = activeCompany(searchParams);
  if (!company || !(isUnrestrictedAdmin(user) || canAccessCompany(user, company))) {
    return NextResponse.json({ error: 'Pick a restaurant you can access' }, { status: 400 });
  }
  return NextResponse.json({ settings: wastePhotoRequiredByDepartment(company) });
}

export async function PUT(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.waste.settings', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  initInventoryTables();

  const body = await request.json();
  const departmentId = Number(body.department_id);
  if (!Number.isInteger(departmentId) || departmentId <= 0) {
    return NextResponse.json({ error: 'department_id required' }, { status: 400 });
  }

  // The department id comes from the client, so ask Odoo whose it really is —
  // a manager of one restaurant must not set policy for another's kitchen.
  let deptCompany: number;
  try {
    const rows = await getOdoo().searchRead('hr.department', [['id', '=', departmentId]], ['company_id']) as
      { company_id: [number, string] | false }[];
    if (!rows.length) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    deptCompany = rows[0].company_id ? rows[0].company_id[0] : 0;
  } catch {
    // Unknown means DON'T: settings are not urgent, so an Odoo hiccup blocks
    // the write rather than guessing the scope.
    return NextResponse.json({ error: 'Could not verify the department — try again' }, { status: 502 });
  }
  if (deptCompany && !(isUnrestrictedAdmin(user) || canAccessCompany(user, deptCompany))) {
    return NextResponse.json({ error: 'Not your restaurant' }, { status: 403 });
  }

  setWastePhotoRequired(departmentId, deptCompany, !!body.photo_required, user.id);
  return NextResponse.json({ message: 'Saved' });
}

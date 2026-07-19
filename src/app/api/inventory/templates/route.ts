export const dynamic = 'force-dynamic';
/**
 * /api/inventory/templates
 *
 * GET  — list counting templates (filtered by location, active)
 * POST — create a new template (manager/admin only)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds, getUserById } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, createTemplate, listTemplates, updateTemplate, generateSessionForTemplate, getTemplate } from '@/lib/inventory-db';

/**
 * The stock location a list counts must belong to its restaurant (or be a
 * shared location). Otherwise a manager could point a list at another
 * company's location and read that company's system quantities. Returns an
 * error message, or null when the location is valid for the company.
 */
async function locationCompanyError(locationId: number, companyId: number): Promise<string | null> {
  const rows = await getOdoo().searchRead('stock.location', [['id', '=', locationId]], ['id', 'company_id'], { limit: 1 });
  if (rows.length === 0) return 'That location no longer exists';
  const loc = rows[0].company_id;
  const locCompany = Array.isArray(loc) ? loc[0] : loc;      // false = shared
  if (locCompany && locCompany !== companyId) return 'That location belongs to another restaurant';
  return null;
}


export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('location_id');
  const active = searchParams.get('active');

  // Only show lists for the caller's restaurant(s) — a full admin with no
  // restriction sees all.
  const allowed = parseCompanyIds(user.allowed_company_ids);
  const adminUnrestricted = user.role === 'admin' && allowed.length === 0;

  const templates = listTemplates({
    location_id: locationId ? parseInt(locationId) : undefined,
    active: active !== null ? active === 'true' : undefined,
    ...(adminUnrestricted ? {} : { company_ids: allowed }),
  });

  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.template.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden \u2014 manager role required' }, { status: 403 });
  }

  initInventoryTables();
  const body = await request.json();
  const { name, frequency, schedule_days, location_id, category_ids, product_ids, assign_type, assign_id } = body;

  if (!name || !location_id) {
    return NextResponse.json({ error: 'name and location_id are required' }, { status: 400 });
  }

  // Which restaurant this list belongs to — drives who sees it on a shared
  // department tablet. Must be a company the manager is allowed (only a full
  // admin with no restriction may pick any); default to the single one when
  // unambiguous; required so the list is never silently invisible.
  const allowed = parseCompanyIds(user.allowed_company_ids);
  const adminUnrestricted = user.role === 'admin' && allowed.length === 0;
  let companyId: number | null = body.company_id != null ? Number(body.company_id) : null;
  if (companyId != null && !adminUnrestricted && !allowed.includes(companyId)) {
    return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
  }
  if (companyId == null && allowed.length === 1) companyId = allowed[0];
  if (companyId == null) {
    return NextResponse.json({ error: 'Pick which restaurant this list is for.' }, { status: 400 });
  }

  const locErr = await locationCompanyError(Number(location_id), companyId);
  if (locErr) return NextResponse.json({ error: locErr }, { status: 400 });

  // A person-assigned list: the assignee must belong to this restaurant. Session
  // generation copies this assignment straight onto sessions and canAccessSession
  // trusts a direct assignment, so a cross-company assignee could otherwise open it.
  if (assign_type === 'person' && assign_id != null) {
    const assignee = getUserById(Number(assign_id));
    if (!assignee) return NextResponse.json({ error: 'That person was not found' }, { status: 400 });
    const ac = parseCompanyIds(assignee.allowed_company_ids);
    const assigneeUnrestricted = assignee.role === 'admin' && ac.length === 0;
    if (!assigneeUnrestricted && !ac.includes(companyId)) {
      return NextResponse.json({ error: 'That person is not in this restaurant' }, { status: 400 });
    }
  }

  const id = createTemplate({
    name,
    frequency: frequency || 'adhoc',
    schedule_days: schedule_days || [],
    location_id,
    company_id: companyId,
    category_ids: category_ids || [],
    product_ids: product_ids || [],
    assign_type: assign_type || null,
    assign_id: assign_id || null,
    created_by: user.id,
  });

  // Auto-generate a counting session for today (respects frequency + schedule_days)
  const sessionId = generateSessionForTemplate(id);

  return NextResponse.json({
    id,
    session_id: sessionId,
    message: sessionId
      ? 'Template created + session generated for today'
      : 'Template created (not scheduled for today)',
  }, { status: 201 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.template.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  initInventoryTables();
  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const allowed = parseCompanyIds(user.allowed_company_ids);
  const adminUnrestricted = user.role === 'admin' && allowed.length === 0;

  // Source ownership: you may only edit a list belonging to your restaurant
  // (a null-company legacy list is editable by any manager, to re-tag it).
  const existing = getTemplate(id);
  if (!existing) return NextResponse.json({ error: 'List not found' }, { status: 404 });
  if (existing.company_id != null && !adminUnrestricted && !allowed.includes(existing.company_id)) {
    return NextResponse.json({ error: 'That list belongs to another restaurant' }, { status: 403 });
  }

  // A re-save may set/repair company_id — only to a restaurant the manager is
  // allowed. Never let an edit null out an existing company (would hide the
  // list from staff); drop an explicit null instead.
  if ('company_id' in updates) {
    if (updates.company_id == null) {
      delete updates.company_id;
    } else if (!adminUnrestricted && !allowed.includes(Number(updates.company_id))) {
      return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
    }
  }

  // A list must always have a location — never let an edit clear it (would
  // both hide system quantities and violate the NOT NULL column).
  if ('location_id' in updates && updates.location_id == null) {
    return NextResponse.json({ error: 'A location is required.' }, { status: 400 });
  }

  // A legacy list with no company must be tagged (to a restaurant you're
  // allowed) before any other edit — otherwise its location can't be checked
  // and it would stay invisible on shared tablets.
  if (existing.company_id == null && !('company_id' in updates)) {
    return NextResponse.json({ error: 'Pick which restaurant this list is for.' }, { status: 400 });
  }

  // Validate the effective location/company pair whenever EITHER changes — a
  // company-only change must not leave a location owned by a different company.
  const effectiveCompany = ('company_id' in updates)
    ? Number(updates.company_id) : (existing.company_id ?? null);
  const effectiveLocation = updates.location_id != null ? Number(updates.location_id) : existing.location_id;
  if (('company_id' in updates || updates.location_id != null) && effectiveCompany != null) {
    const locErr = await locationCompanyError(effectiveLocation, effectiveCompany);
    if (locErr) return NextResponse.json({ error: locErr }, { status: 400 });
  }

  updateTemplate(id, updates);
  return NextResponse.json({ message: 'Template updated' });
}

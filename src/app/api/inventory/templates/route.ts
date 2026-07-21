export const dynamic = 'force-dynamic';
/**
 * /api/inventory/templates
 *
 * GET  — list counting templates (filtered by location, active)
 * POST — create a new template (manager/admin only)
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds, getUserById } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, createTemplate, listTemplates, updateTemplate, generateSessionForTemplate, getTemplate, todayStr, deleteStalePendingSessions } from '@/lib/inventory-db';
import { listShiftTemplates } from '@/lib/shifts-db';

/** A real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-30). */
function isValidYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

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

  // Company selector = source of truth: scope lists to the active restaurant
  // (?company_id or the kw_company_id cookie) when it's one the caller may see,
  // else fall back to their full allowed set. A full admin honours the picker
  // too, or sees all when none is selected.
  const activeCompany = parseInt(searchParams.get('company_id') || '0', 10)
    || parseInt(cookies().get('kw_company_id')?.value || '0', 10);
  let companyIds: number[] | undefined;
  if (adminUnrestricted) {
    companyIds = activeCompany ? [activeCompany] : undefined;
  } else if (activeCompany && allowed.includes(activeCompany)) {
    companyIds = [activeCompany];
  } else {
    companyIds = allowed;
  }

  const templates = listTemplates({
    location_id: locationId ? parseInt(locationId) : undefined,
    active: active !== null ? active === 'true' : undefined,
    ...(companyIds !== undefined ? { company_ids: companyIds } : {}),
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
  const { name, frequency, schedule_days, adhoc_date, location_id, category_ids, product_ids, assign_type, assign_id } = body;

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

  // A typed assignment must be a known type naming a real target (a positive id —
  // '' or 0 must not slip through and silently become "Anyone"). A shift must be
  // one of this restaurant's Planning shift templates (metadata/label only —
  // there is no shift-to-person resolution yet, so the session stays company-wide).
  if (assign_type != null && !['person', 'department', 'shift'].includes(assign_type)) {
    return NextResponse.json({ error: 'Unknown assignment type.' }, { status: 400 });
  }
  // Strict raw-type check on ANY non-null incoming id (even with no assign_type —
  // junk like "abc"/true must never reach the DB), and a typed assignment must
  // have one. No coercion: better-sqlite3 would store strings / 500 on bools.
  if (assign_id != null && !(typeof assign_id === 'number' && Number.isInteger(assign_id) && assign_id > 0)) {
    return NextResponse.json({ error: 'Choose who this list is assigned to.' }, { status: 400 });
  }
  if (assign_type && assign_id == null) {
    return NextResponse.json({ error: 'Choose who this list is assigned to.' }, { status: 400 });
  }
  if (assign_type === 'shift' && !listShiftTemplates(companyId).some((t) => t.id === assign_id)) {
    return NextResponse.json({ error: 'Pick a shift for this list.' }, { status: 400 });
  }

  // Ad-hoc lists generate a single count on a chosen, non-past date. Other
  // frequencies never carry a date.
  const freq = frequency || 'adhoc';
  let adhocDate: string | null = null;
  if (freq === 'adhoc') {
    if (!isValidYmd(adhoc_date)) {
      return NextResponse.json({ error: 'Pick a date for this one-off list.' }, { status: 400 });
    }
    if (adhoc_date < todayStr()) {
      return NextResponse.json({ error: 'The count date can’t be in the past.' }, { status: 400 });
    }
    adhocDate = adhoc_date;
  }

  const id = createTemplate({
    name,
    frequency: freq,
    schedule_days: schedule_days || [],
    adhoc_date: adhocDate,
    location_id,
    company_id: companyId,
    category_ids: category_ids || [],
    product_ids: product_ids || [],
    assign_type: assign_type || null,
    // Normalized: an id is only meaningful WITH a type (validated above).
    assign_id: assign_type ? assign_id : null,
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

  // Ad-hoc date on edit: an ad-hoc list must have a valid date; switching away
  // from ad-hoc clears it. Only reject a PAST date when the date actually CHANGES
  // — the editor always re-sends the stored date, and a legacy past-dated list
  // must stay editable (rename it, deactivate it) without being forced forward.
  const effFreq = 'frequency' in updates ? updates.frequency : existing.frequency;
  if (effFreq === 'adhoc') {
    const effDate = 'adhoc_date' in updates ? updates.adhoc_date : existing.adhoc_date;
    if (!isValidYmd(effDate)) {
      return NextResponse.json({ error: 'Pick a date for this one-off list.' }, { status: 400 });
    }
    const dateChanged = 'adhoc_date' in updates && updates.adhoc_date !== (existing.adhoc_date ?? null);
    if (dateChanged && typeof updates.adhoc_date === 'string' && updates.adhoc_date < todayStr()) {
      return NextResponse.json({ error: 'The count date can’t be in the past.' }, { status: 400 });
    }
  } else {
    // Effective frequency is NOT ad-hoc: a date must never be stored. Clear a
    // stale one on a frequency change; ignore a stray adhoc_date sent alongside
    // other edits (it could otherwise lie dormant and activate on a later
    // frequency-only switch, bypassing the past-date check).
    if ('frequency' in updates) updates.adhoc_date = null;
    else delete updates.adhoc_date;
  }

  // A typed assignment must be a known type naming a real, positive-id target;
  // a shift must belong to this restaurant.
  const effAssignType = 'assign_type' in updates ? updates.assign_type : existing.assign_type;
  const effAssignId = 'assign_id' in updates ? updates.assign_id : existing.assign_id;
  if (effAssignType != null && !['person', 'department', 'shift'].includes(effAssignType)) {
    return NextResponse.json({ error: 'Unknown assignment type.' }, { status: 400 });
  }
  // Strict raw-type check on any INCOMING id (stored ids are already numbers) —
  // no coercion, so a boolean/array/"1e0" can never reach the DB binding.
  if ('assign_id' in updates && updates.assign_id != null
      && !(typeof updates.assign_id === 'number' && Number.isInteger(updates.assign_id) && updates.assign_id > 0)) {
    return NextResponse.json({ error: 'Choose who this list is assigned to.' }, { status: 400 });
  }
  if (effAssignType && !(typeof effAssignId === 'number' && Number.isInteger(effAssignId) && effAssignId > 0)) {
    return NextResponse.json({ error: 'Choose who this list is assigned to.' }, { status: 400 });
  }
  if (effAssignType === 'shift' && effectiveCompany != null
      && !listShiftTemplates(effectiveCompany).some((t) => t.id === effAssignId)) {
    return NextResponse.json({ error: 'Pick a shift for this list.' }, { status: 400 });
  }
  // A person-assigned list: the assignee must belong to this restaurant (same
  // rule as POST — session generation copies the assignment and access control
  // trusts it, so a cross-company assignee would gain access).
  if (effAssignType === 'person' && effectiveCompany != null) {
    const assignee = getUserById(Number(effAssignId));
    if (!assignee) return NextResponse.json({ error: 'That person was not found' }, { status: 400 });
    const ac = parseCompanyIds(assignee.allowed_company_ids);
    const assigneeUnrestricted = assignee.role === 'admin' && ac.length === 0;
    if (!assigneeUnrestricted && !ac.includes(effectiveCompany)) {
      return NextResponse.json({ error: 'That person is not in this restaurant' }, { status: 400 });
    }
  }

  updateTemplate(id, updates);

  // Keep generated sessions consistent with a MOVED ad-hoc date: remove the old
  // date's untouched pending session (else it lingers uncancellable AND the new
  // date spawns a second count), and generate immediately when the new date is
  // today — same behavior as create. Anything staff already started is kept.
  if (effFreq === 'adhoc') {
    if ('adhoc_date' in updates && updates.adhoc_date !== (existing.adhoc_date ?? null)) {
      deleteStalePendingSessions(id, updates.adhoc_date as string);
      generateSessionForTemplate(id);
    }
  } else if ('frequency' in updates && existing.frequency === 'adhoc') {
    // No longer ad-hoc: future-dated untouched leftovers are removed; today's
    // (if any) is kept — a daily/weekly list would regenerate it today anyway.
    deleteStalePendingSessions(id, todayStr());
  }

  return NextResponse.json({ message: 'Template updated' });
}

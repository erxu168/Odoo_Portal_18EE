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
import { initInventoryTables, createTemplate, listTemplates, templatesClashingProducts, updateTemplate, generateSessionForTemplate, ensureTodaySessionForTemplate, getTemplate, todayStr, deleteStalePendingSessions, deleteTemplate, templateHasRealSessions } from '@/lib/inventory-db';
import { listShiftTemplates } from '@/lib/shifts-db';
import { moduleForbidden } from '@/lib/module-access';

/**
 * Product ids as NUMBERS. A string id compares unequal to the stored numeric one,
 * so "12" would slip past the duplicate check and then be stored in a shape
 * nothing else matches (Codex, 2026-08-03). Junk is dropped, not coerced.
 */
function normalizeProductIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === 'number' ? v : (typeof v === 'string' && /^[0-9]+$/.test(v) ? Number(v) : NaN);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return Array.from(new Set(out));
}

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
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

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
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.template.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden \u2014 manager role required' }, { status: 403 });
  }

  initInventoryTables();
  const body = await request.json();
  const { name, frequency, schedule_days, adhoc_date, location_id, category_ids, product_ids, assign_type, assign_id, allow_duplicates } = body;

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
  // 'walk' is the system's internal merged-walk container — never creatable or
  // settable through the API. Reject anything outside the public set.
  if (!['daily', 'weekly', 'monthly', 'adhoc'].includes(freq)) {
    return NextResponse.json({ error: 'Unknown frequency' }, { status: 400 });
  }
  // Weekly needs weekday numbers (0-6); monthly needs ONE day of month (1-31).
  // Validated here so a stale or hand-made client can't store a schedule that
  // silently never fires (or fires on the wrong day).
  if (freq === 'weekly') {
    const days: unknown[] = Array.isArray(schedule_days) ? schedule_days : [];
    if (days.length === 0 || !days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) {
      return NextResponse.json({ error: 'Pick at least one weekday for a weekly list.' }, { status: 400 });
    }
  }
  if (freq === 'monthly') {
    const days: unknown[] = Array.isArray(schedule_days) ? schedule_days : [];
    if (days.length !== 1 || !Number.isInteger(days[0]) || (days[0] as number) < 1 || (days[0] as number) > 31) {
      return NextResponse.json({ error: 'Pick the day of the month for a monthly list.' }, { status: 400 });
    }
  }
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

  // A product already on ANOTHER of this restaurant's lists means staff walk to
  // the same shelf twice and the day ends with two different answers for one
  // product. Advisory, not a block: the manager is shown exactly which products
  // clash and chooses. `allow_duplicates` is that choice coming back.
  // Consent must be the literal true — "false", 1 and {} are all truthy and
  // would silently wave the warning through (Codex, 2026-08-03).
  // Normalise ONCE and store what we checked — checking numbers then storing
  // "12" would leave a list nothing can ever match again (Codex, 2026-08-03).
  const cleanProductIds = normalizeProductIds(product_ids);
  if (allow_duplicates !== true) {
    const clash = templatesClashingProducts(companyId, cleanProductIds);
    if (clash.length > 0) {
      return NextResponse.json({ error: 'DUPLICATE_PRODUCTS', clash }, { status: 409 });
    }
  }

  const id = createTemplate({
    name,
    frequency: freq,
    schedule_days: schedule_days || [],
    adhoc_date: adhocDate,
    location_id,
    company_id: companyId,
    category_ids: category_ids || [],
    product_ids: cleanProductIds,
    assign_type: assign_type || null,
    // Normalized: an id is only meaningful WITH a type (validated above).
    assign_id: assign_type ? assign_id : null,
    created_by: user.id,
  });

  // Auto-generate today's count (respects frequency + schedule_days) — and if
  // this restaurant already has a combined walk today, JOIN it rather than
  // creating a second session whose overlapping products would be counted twice.
  const gen = ensureTodaySessionForTemplate(id);

  return NextResponse.json({
    id,
    session_id: gen.sessionId,
    joined_walk: gen.joinedWalk,
    deferred: gen.deferred,
    // Honest about WHY there is no count today. The old wording for a deferral
    // read "not scheduled for today", which was simply untrue and left a
    // manager with no idea what had happened (Ethan, 3 Aug: he made the weekly
    // list at 13:32 mid-service and got a second card with no explanation).
    message: gen.joinedWalk
      ? 'List created and added to today\u2019s count'
      : gen.deferred
        ? 'List created \u2014 but a count is already running today that covers some of these products, so this list starts on its next scheduled day. Counting them twice today would give you two different answers.'
        : gen.sessionId
          ? 'Template created + session generated for today'
          : 'Template created (not scheduled for today)',
  }, { status: 201 });
}

export async function PUT(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

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

  // Same duplicate check as on create — adding a product to one list that
  // another list already counts is the same accident, just later.
  if (updates.allow_duplicates !== true) {
    // Check the products this list will HAVE, which is not always the ones in
    // the request: re-tagging a legacy list to a restaurant moves its existing
    // products into that restaurant's world without ever sending product_ids
    // (Codex, 2026-08-03).
    const effectiveProducts = Array.isArray(updates.product_ids)
      ? normalizeProductIds(updates.product_ids)
      : normalizeProductIds(existing.product_ids as number[]);
    if (Array.isArray(updates.product_ids)) updates.product_ids = effectiveProducts;
    const clash = templatesClashingProducts(effectiveCompany, effectiveProducts, { excludeTemplateId: Number(id) });
    if (clash.length > 0) {
      return NextResponse.json({ error: 'DUPLICATE_PRODUCTS', clash }, { status: 409 });
    }
  }
  delete updates.allow_duplicates;   // a UI choice, never a stored column

  // Ad-hoc date on edit: an ad-hoc list must have a valid date; switching away
  // from ad-hoc clears it. Only reject a PAST date when the date actually CHANGES
  // — the editor always re-sends the stored date, and a legacy past-dated list
  // must stay editable (rename it, deactivate it) without being forced forward.
  const effFreq = 'frequency' in updates ? updates.frequency : existing.frequency;
  // 'walk' is the internal merged-walk container: it can never be set through
  // the API, and an existing walk row can never be edited into something else
  // (either would break the one-walk-per-company invariant).
  if (existing.frequency === 'walk') {
    return NextResponse.json({ error: 'That list is managed automatically' }, { status: 400 });
  }
  if (!['daily', 'weekly', 'monthly', 'adhoc'].includes(effFreq)) {
    return NextResponse.json({ error: 'Unknown frequency' }, { status: 400 });
  }
  // Same schedule shape rules as create, on the EFFECTIVE values.
  const effDays: unknown[] = 'schedule_days' in updates
    ? (Array.isArray(updates.schedule_days) ? updates.schedule_days : [])
    : (Array.isArray(existing.schedule_days) ? existing.schedule_days : []);
  if (effFreq === 'weekly'
    && (effDays.length === 0 || !effDays.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))) {
    return NextResponse.json({ error: 'Pick at least one weekday for a weekly list.' }, { status: 400 });
  }
  if (effFreq === 'monthly'
    && (effDays.length !== 1 || !Number.isInteger(effDays[0]) || (effDays[0] as number) < 1 || (effDays[0] as number) > 31)) {
    return NextResponse.json({ error: 'Pick the day of the month for a monthly list.' }, { status: 400 });
  }
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

  // A product ARCHIVED since the editor loaded must not be added by a save from
  // that stale screen — two managers working at once, or one with the Add
  // sheet open for a while. Only NEWLY added ids are checked: a product already
  // on the list stays, because archiving deliberately does not take it off (the
  // list says so on screen, and the next count really does include it).
  if (Array.isArray(updates.product_ids)) {
    const wanted: number[] = updates.product_ids.map(Number).filter(Number.isFinite);
    // getTemplate already parses this into an array.
    const before: number[] = Array.isArray(existing.product_ids) ? existing.product_ids : [];
    const added = wanted.filter((pid) => !before.includes(pid));
    if (added.length > 0) {
      try {
        const odoo = getOdoo();
        const live = await odoo.searchRead(
          'product.product', [['id', 'in', added], ['active', '=', true]], ['id'],
        ) as { id: number }[];
        const liveIds = new Set(live.map((r) => r.id));
        const refused = added.filter((pid) => !liveIds.has(pid));
        if (refused.length > 0) {
          const names = await odoo.searchRead(
            'product.product', [['id', 'in', refused]], ['id', 'name'],
            { context: { active_test: false } },
          ) as { id: number; name: string }[];
          const listed = names.map((n) => n.name).join(', ') || `${refused.length} product(s)`;
          return NextResponse.json({
            error: `Archived or deleted since you opened this list: ${listed}. Reopen the list and try again.`,
            code: 'ADDED_NOT_LIVE',
            product_ids: refused,
          }, { status: 409 });
        }
      } catch (e) {
        // Odoo unreachable is NOT a reason to lose the manager's edit — the
        // worst case is an archived id on a list, which the editor now shows
        // and explains. Log it and save.
        console.warn('[inventory] could not verify newly added products are live:', e);
      }
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
      ensureTodaySessionForTemplate(id);
    }
  } else if ('frequency' in updates && existing.frequency === 'adhoc') {
    // No longer ad-hoc: future-dated untouched leftovers are removed; today's
    // (if any) is kept — a daily/weekly list would regenerate it today anyway.
    deleteStalePendingSessions(id, todayStr());
  }

  return NextResponse.json({ message: 'Template updated' });
}

/**
 * DELETE /api/inventory/templates?id= — permanently remove a counting list and
 * ALL its counts (sessions + entries). Manager-only, scoped to the list's
 * restaurant. Irreversible — the UI confirms first.
 */
export async function DELETE(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.template.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden — manager role required' }, { status: 403 });
  }
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const idRaw = searchParams.get('id');
  if (!idRaw || !/^\d+$/.test(idRaw)) return NextResponse.json({ error: 'A valid list id is required' }, { status: 400 });
  const id = parseInt(idRaw, 10);

  const tmpl = getTemplate(id);
  if (!tmpl) return NextResponse.json({ error: 'List not found' }, { status: 404 });

  const allowed = parseCompanyIds(user.allowed_company_ids);
  const isAdmin = user.role === 'admin';
  const adminUnrestricted = isAdmin && allowed.length === 0;

  // A null-company legacy list is quarantined to an unrestricted admin (mirrors
  // how legacy sessions are scoped) — a manager can't claim or purge it.
  if (tmpl.company_id == null) {
    // Orphan legacy list (no restaurant) — any ADMIN may clean it up / re-tag it
    // (admins are cross-company by design); a company-scoped admin is still an
    // admin. A plain manager cannot.
    if (!isAdmin) return NextResponse.json({ error: 'List not found' }, { status: 404 });
  } else if (!adminUnrestricted && !allowed.includes(tmpl.company_id)) {
    return NextResponse.json({ error: 'That list belongs to another restaurant' }, { status: 403 });
  }

  // HARD delete destroys count history (submitted/approved sessions are audit
  // evidence + feed the consumption report). A non-admin manager may only purge a
  // list with NO real counts; a list that has history should be deactivated
  // (active:false) instead. ANY admin may permanently erase it — company scope
  // (not the "unrestricted" flag) already governs WHICH lists they can reach, so
  // an admin restricted to their own restaurant can still purge that list.
  // The synthetic merged-walk container is infrastructure — deleting it would
  // orphan today's combined count and break the one-walk-per-company invariant.
  if (tmpl.frequency === 'walk') {
    return NextResponse.json({ error: 'That list is managed automatically' }, { status: 400 });
  }

  if (templateHasRealSessions(id) && !isAdmin) {
    return NextResponse.json({
      error: 'This list has counts recorded. Deactivate it instead, or ask an admin to permanently delete it.',
    }, { status: 409 });
  }

  deleteTemplate(id);
  return NextResponse.json({ message: 'List deleted' });
}

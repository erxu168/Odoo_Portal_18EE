export const dynamic = 'force-dynamic';
/**
 * /api/inventory/sessions
 *
 * GET  — list sessions (filter by status, template, location, date)
 *       Staff: only sees sessions assigned to them
 *       Manager/Admin: sees all sessions
 * POST — create a new session from a template (manager/admin)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds, getUserById } from '@/lib/db';
import { initInventoryTables, todayStr, createSession, listSessions, getSession, getSessionByTemplateAndDate, walkSessionForTemplateToday, ensureTodaySessionForTemplate, productsAlreadyCountedToday, isUniqueViolation, updateSessionStatus, generateTodaySessions, getSessionEntries, getTemplate, getProductFlags, getCountPhotosMap , getSessionItems , saveSessionStaffNote } from '@/lib/inventory-db';
import { canAccessSession, companyScope } from '@/lib/inventory-access';
import { isCanonicalDay } from '@/lib/berlin-date';
import { resolveSessionRoute } from '@/lib/session-route';
import { allowedProductIds } from '@/lib/inventory-scope';
import { logAudit } from '@/lib/db';


export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();

  // Auto-generate today's sessions if they don't exist yet (idempotent),
  // scoped to the caller's restaurant(s) so a load can't spawn another
  // company's sessions. Unrestricted admin (no company) generates all.
  {
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const adminUnrestricted = user.role === 'admin' && allowed.length === 0;
    try { generateTodaySessions(adminUnrestricted ? undefined : allowed); } catch (_e) { /* non-fatal */ }
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') as string | null;
  const templateId = searchParams.get('template_id');
  const locationId = searchParams.get('location_id');
  const date = searchParams.get('date'); // YYYY-MM-DD format

  // Staff see sessions assigned to them PLUS unassigned ("Anyone"/department)
  // lists for their restaurant(s); managers/admins see all.
  const isStaff = !hasRole(user, 'manager');
  // Managers/admins are scoped to their companies (unrestricted admin = no filter);
  // staff use the assigned-or-unassigned-in-company visibility rule.
  const scope = companyScope(user);

  const sessions = listSessions({
    // 'pending,in_progress' — a started count must stay visible to its counter.
    status: (status ? (status.includes(',') ? status.split(',').map((s) => s.trim()).filter(Boolean) : status) : undefined) as undefined,
    template_id: templateId ? parseInt(templateId) : undefined,
    location_id: locationId ? parseInt(locationId) : undefined,
    scheduled_date: date || undefined,
    ...(isStaff
      ? { visibleTo: { userId: user.id, companyIds: parseCompanyIds(user.allowed_company_ids) } }
      : (scope ? { company_ids: scope } : {})),
  });

  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.template.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  initInventoryTables();
  const body = await request.json();

  // Generate today's sessions from active templates — scoped to the manager's
  // restaurant(s); a full admin with no restriction generates all.
  if (body.action === 'generate_today') {
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const adminUnrestricted = user.role === 'admin' && allowed.length === 0;
    const result = generateTodaySessions(adminUnrestricted ? undefined : allowed);
    return NextResponse.json({ ...result, message: `Generated ${result.created} sessions (${result.skipped} skipped)` });
  }

  const { template_id, scheduled_date, assigned_user_id } = body;

  if (!template_id || !scheduled_date) {
    return NextResponse.json({ error: 'template_id and scheduled_date required' }, { status: 400 });
  }
  // Canonical day only — every date comparison downstream (dedupe, usage
  // ordering, Berlin-day windows) relies on a strict, REAL YYYY-MM-DD (an
  // impossible day like 2026-02-31 would silently roll into March).
  if (!isCanonicalDay(scheduled_date)) {
    return NextResponse.json({ error: 'scheduled_date must be a valid YYYY-MM-DD day' }, { status: 400 });
  }

  // Location + company come from the template (never the client) so a session
  // can't be pointed at another restaurant's stock location.
  const tmpl = getTemplate(template_id);
  if (!tmpl) return NextResponse.json({ error: 'List not found' }, { status: 404 });
  // The synthetic merged-walk container is not a list anyone may create counts
  // for — its sessions are made by the generator alone.
  if (tmpl.frequency === 'walk') {
    return NextResponse.json({ error: 'That list is managed automatically' }, { status: 400 });
  }
  const allowed = parseCompanyIds(user.allowed_company_ids);
  const adminUnrestricted = user.role === 'admin' && allowed.length === 0;
  if (!adminUnrestricted) {
    // A legacy untagged list has no company to authorize against and could
    // carry a cross-company location — tag it first.
    if (tmpl.company_id == null) {
      return NextResponse.json({ error: 'Tag this list with a restaurant before starting a count.' }, { status: 400 });
    }
    if (!allowed.includes(tmpl.company_id)) {
      return NextResponse.json({ error: 'That list belongs to another restaurant' }, { status: 403 });
    }
  }

  // If a specific person is assigned, they must belong to this list's restaurant
  // (else a session could be assigned to — and thus opened by — someone in another
  // company, since canAccessSession trusts a direct assignment).
  if (assigned_user_id != null) {
    const assignee = getUserById(Number(assigned_user_id));
    if (!assignee) return NextResponse.json({ error: 'That person was not found' }, { status: 400 });
    if (tmpl.company_id != null) {
      const ac = parseCompanyIds(assignee.allowed_company_ids);
      const assigneeUnrestricted = assignee.role === 'admin' && ac.length === 0;
      if (!assigneeUnrestricted && !ac.includes(tmpl.company_id)) {
        return NextResponse.json({ error: 'That person is not in this restaurant' }, { status: 400 });
      }
    }
  }

  // TODAY goes through the merge-aware path: if this restaurant already has a
  // combined walk, the list joins it (or waits for tomorrow) instead of getting
  // a second session whose overlapping products would be counted twice.
  // Only the MERGE cases divert: if this restaurant has a combined walk today,
  // the list joins it (or waits for its next scheduled day) rather than getting
  // a second session whose overlapping products would be counted twice.
  // Everything else falls through to the ordinary create below, which honours
  // the requested assigned_user_id exactly as before.
  if (scheduled_date === todayStr()) {
    const walkToday = walkSessionForTemplateToday(template_id);
    if (walkToday) {
      return NextResponse.json({ id: walkToday.id, message: 'This list is part of today\u2019s combined count' });
    }
    // Only DIVERT when a combined walk exists for this restaurant today: then
    // the list joins it (untouched) or waits (its products are already being
    // counted). With no walk, fall through to the ordinary create below, which
    // honours the requested assigned_user_id exactly as before.
    const gen = ensureTodaySessionForTemplate(template_id, { createIfNoWalk: false });
    if (gen.joinedWalk && gen.sessionId != null) {
      return NextResponse.json({ id: gen.sessionId, message: 'This list is part of today\u2019s combined count' });
    }
    if (gen.deferred) {
      return NextResponse.json({
        error: 'Today\u2019s combined count is already under way and covers some of these products. This list is counted from its next scheduled day.',
      }, { status: 409 });
    }
  }

  // The one invariant: never open a count for products another open count of
  // this restaurant already covers today (they would be written to Odoo twice).
  if (tmpl.company_id != null) {
    const clash = productsAlreadyCountedToday(tmpl.company_id, (tmpl.product_ids as number[]) || [], { date: scheduled_date });
    if (clash.length > 0 && !getSessionByTemplateAndDate(template_id, scheduled_date)) {
      return NextResponse.json({
        error: `${clash.length} of these products ${clash.length === 1 ? 'is' : 'are'} already in another count for that day.`,
      }, { status: 409 });
    }
  }

  // A list has at most one count per day (idx_sessions_template_date). Creating
  // for a day that already has one returns THAT session instead of tripping the
  // unique index into a 500 — the manual create is idempotent per (list, day).
  const existing = getSessionByTemplateAndDate(template_id, scheduled_date);
  if (existing) {
    return NextResponse.json({ id: existing.id, message: 'A count for this list and day already exists' });
  }
  let id: number;
  try {
    id = createSession({
      template_id,
      scheduled_date,
      location_id: tmpl.location_id,
      company_id: tmpl.company_id ?? null,
      assigned_user_id,
    });
  } catch (e) {
    // Lost a create race — the day's session appeared between our check and the
    // insert. ONLY a duplicate-key violation is a race; a snapshot/schema/storage
    // failure is real and must surface even if a competing row happens to exist.
    if (!isUniqueViolation(e)) throw e;
    const winner = getSessionByTemplateAndDate(template_id, scheduled_date);
    if (!winner) throw e;
    return NextResponse.json({ id: winner.id, message: 'A count for this list and day already exists' });
  }
  return NextResponse.json({ id, message: 'Session created' }, { status: 201 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const body = await request.json();
  const { id, status, review_note, staff_note } = body;
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

  // Only these transitions exist here. Approval goes through /api/inventory/approve
  // (which writes Odoo stock) — never this generic endpoint — so 'approved' is not
  // accepted here. Any other/arbitrary status is rejected outright.
  const VALID_STATUSES = ['submitted', 'rejected', 'pending'];
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  // Load + authorize the session ONCE for EVERY transition, so a guessed id can
  // never change the status of another restaurant's / someone else's count.
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!canAccessSession(user, session)) {
    return NextResponse.json({ error: 'This count belongs to another restaurant' }, { status: 403 });
  }

  // Managers reject/reopen; staff submit.
  if (status === 'rejected' && !roleCan(user.role, 'inventory.review.approve', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // A count can only be rejected while it is submitted (never overwrite an
  // already-approved/pending one).
  if (status === 'rejected' && session.status !== 'submitted') {
    return NextResponse.json({ error: 'Only a submitted count can be rejected' }, { status: 400 });
  }

  // On submit: enforce count completion + save proof photo
  if (status === 'submitted') {
    if (session.status !== 'pending' && session.status !== 'in_progress')
      return NextResponse.json({ error: 'This count has already been submitted' }, { status: 400 });

    const entries = getSessionEntries(id);

    // Completion gate: if this session HAS a guided route (its products are
    // placed into locations), every location must be counted or skipped — even
    // if the staff set no statuses. Otherwise use the flat all-counted gate.
    // (Sessions whose products aren't placed anywhere are guided:false.)
    // A LEGACY count (no frozen snapshot) is spot-less: POST /counts pins every
    // one of its entries to location 0 on purpose. Its products may still have
    // live placements, so the route builder happily reports stops it can never
    // receive an entry at — gating on those would deadlock the count forever.
    // Only a snapshotted session is judged place by place.
    const route = resolveSessionRoute(id);
    const hasSnapshot = getSessionItems(id).length > 0;
    if (route.guided && hasSnapshot) {
      // A stop is dealt with when staff COUNTED something there or explicitly
      // skipped it with a reason. Counting is the signal — there is no longer a
      // "done here" button to press (the count screen is one scroll, not doors
      // you open), so gating on stop status alone would make submitting
      // IMPOSSIBLE. Partially-counted stops pass, exactly as before; the review
      // screen and the manager both still see every uncounted line.
      // "Dealt with" is judged on evidence only: a number written here, or an
      // explicit skip. A stored 'counted' status is NOT accepted — the button
      // that set it is gone, so the only way one exists now is a stale row, and
      // honouring it would wave through a place nobody actually visited.
      // EVERY product needs an answer — a number, "nothing here", or
      // "couldn't find it". A guided count used to pass once each STOP had been
      // touched, so counting one product in the walk-in waved through the other
      // nine and they reached the manager as silent blanks.
      //
      // A SKIPPED spot answers everything in it: once somebody has said the
      // freezer was locked, making them tap ten more times only teaches people
      // to invent numbers.
      const answered = new Set<string>();
      entries.forEach((e: any) => answered.add(`${e.product_id}:${e.count_location_id ?? 0}`));
      const skipped = new Set(
        route.stops.filter((s) => s.status === 'skipped').map((s) => s.bucket_id),
      );

      const unanswered: { product_id: number; bucket: number }[] = [];
      for (const stop of route.stops) {
        if (skipped.has(stop.bucket_id)) continue;
        for (const pid of stop.product_ids) {
          if (!answered.has(`${pid}:${stop.bucket_id}`)) unanswered.push({ product_id: pid, bucket: stop.bucket_id });
        }
      }

      if (unanswered.length > 0) {
        // The IDS travel back, not names: the counting screen already has every
        // product loaded and can say "Scotch bonnet, fresh" where the server
        // would only manage "#1712" without another Odoo round-trip. It also
        // lets the screen jump straight to them.
        const n = unanswered.length;
        return NextResponse.json({
          error: `${n} product${n === 1 ? '' : 's'} still ${n === 1 ? 'has' : 'have'} no answer. Count each one, or mark it "nothing here" or "couldn't find it".`,
          code: 'UNANSWERED_PRODUCTS',
          unanswered: unanswered.map((u) => u.product_id),
          unanswered_lines: unanswered,
        }, { status: 400 });
      }
    } else {
      // Flat completion gate. MODERN sessions validate against the FROZEN
      // snapshot lines (per product+spot) — a template edited after creation
      // can neither hide required lines nor demand new ones.
      const snapshot = getSessionItems(session.id);
      if (snapshot.length > 0) {
        const have = new Set(entries.map((e: any) => `${e.product_id}:${e.count_location_id ?? 0}`));
        const missing = snapshot.filter((it: any) => !have.has(`${it.odoo_product_id}:${it.count_location_id}`));
        if (missing.length > 0) {
          return NextResponse.json({
            error: `Please count all items before submitting. ${snapshot.length - missing.length}/${snapshot.length} counted.`,
            code: 'INCOMPLETE_COUNT',
          }, { status: 400 });
        }
      } else {
        // No snapshot: ask what this list is FOR. A category list ("count
        // everything in Drinks") names no products, so the old check — which
        // only ran when the explicit list was non-empty — let 1 of 200 count as
        // finished. The same helper the save and approve paths use answers it.
        // activeOnly: this decides what MUST be answered, and the counting
        // screen only ever lists active products. Demanding an archived one
        // would make the count unsubmittable with nothing a person could do
        // about it. Saving still accepts archived products — a different
        // question, asked elsewhere with the permissive scope.
        const scope = await allowedProductIds(session, { activeOnly: true });
        const required = scope.kind === 'known' ? Array.from(scope.ids) : [];
        if (required.length > 0) {
          // Coverage, not row count: EVERY required product must have an entry, so
          // extraneous/left-over rows can't satisfy the gate.
          const counted = new Set(entries.map((e: any) => e.product_id));
          const missing = required.filter((pid) => !counted.has(pid));
          if (missing.length > 0) {
            return NextResponse.json({
              error: `Please count all items before submitting. ${required.length - missing.length}/${required.length} counted.`,
              code: 'INCOMPLETE_COUNT',
            }, { status: 400 });
          }
        }
      }
    }

    // Enforce the photo requirement: a flagged line with a real quantity needs
    // a photo.
    //
    // The rule comes from the SESSION'S OWN frozen copy where there is one. A
    // manager switching the flag off mid-count used to retire the requirement
    // from lines already counted under it, and switching it on demanded photos
    // for lines counted before anyone asked. The count is judged by the rules it
    // started under; only a snapshot-less legacy count falls back to live flags.
    {
      const snapshot = getSessionItems(session.id);
      const frozen = new Map<string, boolean>();
      snapshot.forEach((it: any) => frozen.set(`${it.odoo_product_id}:${it.count_location_id}`, !!it.requires_photo));
      const productIds = entries.map((e: any) => e.product_id);
      const flagRows = getProductFlags(productIds);
      const flagMap: Record<number, boolean> = {};
      flagRows.forEach((f: any) => { flagMap[f.odoo_product_id] = !!f.requires_photo; });
      const needsPhoto = (e: any) => {
        const k = `${e.product_id}:${e.count_location_id ?? 0}`;
        return frozen.has(k) ? frozen.get(k)! : !!flagMap[e.product_id];
      };
      const photoMap = getCountPhotosMap('count_entries', entries.map((e: any) => e.id));
      const missing = entries.filter((e: any) =>
        needsPhoto(e) && e.counted_qty > 0 && (photoMap[e.id]?.length || 0) === 0
      );
      if (missing.length > 0) {
        return NextResponse.json({
          error: `${missing.length} item${missing.length !== 1 ? 's' : ''} still need a photo`,
          code: 'PHOTO_REQUIRED',
        }, { status: 400 });
      }
    }

  }

  // Recount: manager reopens a rejected session so staff can try again
  if (status === 'pending') {
    if (!roleCan(user.role, 'inventory.review.approve', getPermissionOverrides())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (session.status !== 'rejected') {
      return NextResponse.json({ error: 'Only rejected sessions can be reopened for recount' }, { status: 400 });
    }
    if (updateSessionStatus(id, 'pending', { fromStatus: 'rejected' }) === 0) {
      return NextResponse.json({ error: 'This count was just changed by someone else — reload and try again.' }, { status: 409 });
    }
    logAudit({ user_id: user.id, user_name: user.name, action: 'recount', module: 'inventory', target_type: 'session', target_id: id, detail: `Reopened session for recount (was rejected)` });
    return NextResponse.json({ message: 'Session reopened for recount' });
  }

  const fromStatus = status === 'submitted' ? ['pending', 'in_progress']
    : status === 'rejected' ? ['submitted'] : undefined;
  if (updateSessionStatus(id, status, { reviewed_by: user.id, review_note, fromStatus }) === 0) {
    return NextResponse.json({ error: 'This count was just changed by someone else — reload and try again.' }, { status: 409 });
  }

  // What staff want the manager to know about the whole count ("basement was
  // locked"). Written AFTER the guarded transition wins: a 409 must leave the
  // session exactly as it was, note included.
  if (typeof staff_note === 'string') {
    saveSessionStaffNote(id, staff_note.trim().slice(0, 1000) || null);
  }

  // Audit log for approve/reject/submit
  if (['approved', 'rejected', 'submitted'].includes(status)) {
    logAudit({
      user_id: user.id,
      user_name: user.name,
      action: status,
      module: 'inventory',
      target_type: 'session',
      target_id: id,
      detail: review_note || undefined,
    });
  }

  return NextResponse.json({ message: `Session ${status}` });
}

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
import { initInventoryTables, createSession, listSessions, getSession, updateSessionStatus, generateTodaySessions, saveSessionProofPhoto, getSessionEntries, getTemplate, getProductFlags, getCountPhotosMap } from '@/lib/inventory-db';
import { canAccessSession, companyScope } from '@/lib/inventory-access';
import { resolveSessionRoute } from '@/lib/session-route';
import { missedStops } from '@/lib/guided-route';
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
    status: (status || undefined) as undefined,
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

  // Location + company come from the template (never the client) so a session
  // can't be pointed at another restaurant's stock location.
  const tmpl = getTemplate(template_id);
  if (!tmpl) return NextResponse.json({ error: 'List not found' }, { status: 404 });
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

  const id = createSession({
    template_id,
    scheduled_date,
    location_id: tmpl.location_id,
    company_id: tmpl.company_id ?? null,
    assigned_user_id,
  });
  return NextResponse.json({ id, message: 'Session created' }, { status: 201 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const body = await request.json();
  const { id, status, review_note, proof_photo } = body;
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
    const route = resolveSessionRoute(id);
    if (route.guided) {
      // Every location with products must be visited (counted) or skipped with a
      // reason. Uncounted items inside a visited location submit as "not counted",
      // matching the flat flow — so we gate on the stop status, not per-item.
      const missed = missedStops(route.stops);
      if (missed.length > 0) {
        const names = missed.map((s) => (s.location ? s.location.name : 'Everything else'));
        return NextResponse.json({
          error: `Count or skip every location first. Still to do: ${names.join(', ')}.`,
          code: 'MISSED_LOCATIONS',
        }, { status: 400 });
      }
    } else {
      // Flat completion gate (unchanged, behavior-preserving).
      const template = getTemplate(session.template_id);
      if (template) {
        // getTemplate returns product_ids already parsed to number[] (parseTemplate).
        const productIds: number[] = Array.isArray(template.product_ids) ? template.product_ids : [];
        if (productIds.length > 0) {
          // Coverage, not row count: EVERY required product must have an entry, so
          // extraneous/left-over rows can't satisfy the gate.
          const counted = new Set(entries.map((e: any) => e.product_id));
          const missing = productIds.filter((pid) => !counted.has(pid));
          if (missing.length > 0) {
            return NextResponse.json({
              error: `Please count all items before submitting. ${productIds.length - missing.length}/${productIds.length} counted.`,
              code: 'INCOMPLETE_COUNT',
            }, { status: 400 });
          }
        }
      }
    }

    // Enforce photo requirement: for any flagged product with qty > 0,
    // there must be at least one photo attached.
    {
      const productIds = entries.map((e: any) => e.product_id);
      const flagRows = getProductFlags(productIds);
      const flagMap: Record<number, boolean> = {};
      flagRows.forEach((f: any) => { flagMap[f.odoo_product_id] = !!f.requires_photo; });
      const photoMap = getCountPhotosMap('count_entries', entries.map((e: any) => e.id));
      const missing = entries.filter((e: any) =>
        flagMap[e.product_id] && e.counted_qty > 0 && (photoMap[e.id]?.length || 0) === 0
      );
      if (missing.length > 0) {
        return NextResponse.json({
          error: `${missing.length} item${missing.length !== 1 ? 's' : ''} still need a photo`,
          code: 'PHOTO_REQUIRED',
        }, { status: 400 });
      }
    }

    // Save proof photo if provided
    if (proof_photo) {
      saveSessionProofPhoto(id, proof_photo);
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

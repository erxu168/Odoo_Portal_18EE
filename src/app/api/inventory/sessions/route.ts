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
import { getPermissionOverrides, parseCompanyIds } from '@/lib/db';
import { createSession, listSessions, getSession, updateSessionStatus, generateTodaySessions, saveSessionProofPhoto, getSessionEntries, getTemplate, getProductFlags, getCountPhotosMap } from '@/lib/inventory-db';
import { canAccessSession } from '@/lib/inventory-access';
import { resolveSessionRoute } from '@/lib/session-route';
import { missedStops } from '@/lib/guided-route';
import { logAudit } from '@/lib/db';


export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  const sessions = listSessions({
    status: (status || undefined) as undefined,
    template_id: templateId ? parseInt(templateId) : undefined,
    location_id: locationId ? parseInt(locationId) : undefined,
    scheduled_date: date || undefined,
    ...(isStaff
      ? { visibleTo: { userId: user.id, companyIds: parseCompanyIds(user.allowed_company_ids) } }
      : {}),
  });

  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.template.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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

  const body = await request.json();
  const { id, status, review_note, proof_photo } = body;
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

  // Staff can submit; managers can approve/reject/reopen
  if (['approved', 'rejected'].includes(status) && !roleCan(user.role, 'inventory.review.approve', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // On submit: enforce count completion + save proof photo
  if (status === 'submitted') {
    const session = getSession(id);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    // The assigned staff, any staff of the restaurant for an unassigned list,
    // or a manager may submit — and only while still editable.
    if (!canAccessSession(user, session))
      return NextResponse.json({ error: 'This is not your count to submit' }, { status: 403 });
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
        const productIds: number[] = (() => {
          try { return JSON.parse((template as unknown as Record<string, string>).product_ids || '[]'); } catch { return []; }
        })();
        const expectedCount = productIds.length > 0 ? productIds.length : 0;
        if (expectedCount > 0 && entries.length < expectedCount) {
          return NextResponse.json({
            error: `Please count all items before submitting. ${entries.length}/${expectedCount} counted.`,
            code: 'INCOMPLETE_COUNT',
          }, { status: 400 });
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
    const session = getSession(id);
    if (!session || session.status !== 'rejected') {
      return NextResponse.json({ error: 'Only rejected sessions can be reopened for recount' }, { status: 400 });
    }
    updateSessionStatus(id, 'pending');
    logAudit({ user_id: user.id, user_name: user.name, action: 'recount', module: 'inventory', target_type: 'session', target_id: id, detail: `Reopened session for recount (was rejected)` });
    return NextResponse.json({ message: 'Session reopened for recount' });
  }

  updateSessionStatus(id, status, { reviewed_by: user.id, review_note });

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

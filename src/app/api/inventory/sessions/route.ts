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
import { createSession, listSessions, getSession, updateSessionStatus, generateTodaySessions, saveSessionProofPhoto, getSessionEntries, getTemplate } from '@/lib/inventory-db';
import { logAudit } from '@/lib/db';


export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Auto-generate today's sessions if they don't exist yet (idempotent)
  try { generateTodaySessions(); } catch (_e) { /* non-fatal */ }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') as string | null;
  const templateId = searchParams.get('template_id');
  const locationId = searchParams.get('location_id');
  const date = searchParams.get('date'); // YYYY-MM-DD format

  // Staff only see sessions assigned to them; managers/admins see all
  const isStaff = !hasRole(user, 'manager');

  const sessions = listSessions({
    status: (status || undefined) as undefined,
    template_id: templateId ? parseInt(templateId) : undefined,
    location_id: locationId ? parseInt(locationId) : undefined,
    assigned_user_id: isStaff ? user.id : undefined,
    scheduled_date: date || undefined,
  });

  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();

  // Generate all today's sessions from active templates
  if (body.action === 'generate_today') {
    const result = generateTodaySessions();
    return NextResponse.json({ ...result, message: `Generated ${result.created} sessions (${result.skipped} skipped)` });
  }

  const { template_id, scheduled_date, location_id, assigned_user_id } = body;

  if (!template_id || !scheduled_date || !location_id) {
    return NextResponse.json({ error: 'template_id, scheduled_date, location_id required' }, { status: 400 });
  }

  const id = createSession({ template_id, scheduled_date, location_id, assigned_user_id });
  return NextResponse.json({ id, message: 'Session created' }, { status: 201 });
}

export async function PUT(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { id, status, review_note, proof_photo } = body;
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

  // Staff can submit; managers can approve/reject/reopen
  if (['approved', 'rejected'].includes(status) && !hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // On submit: enforce count completion + save proof photo
  if (status === 'submitted') {
    const session = getSession(id);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    // Check count completion: require all products counted
    const entries = getSessionEntries(id);
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

    // Save proof photo if provided
    if (proof_photo) {
      saveSessionProofPhoto(id, proof_photo);
    }
  }

  // Recount: manager reopens a rejected session so staff can try again
  if (status === 'pending') {
    if (!hasRole(user, 'manager')) {
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

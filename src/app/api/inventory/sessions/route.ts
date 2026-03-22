/**
 * /api/inventory/sessions
 *
 * GET  — list sessions (filter by status, template, location)
 *       Staff: only sees sessions assigned to them
 *       Manager/Admin: sees all sessions
 * POST — create a new session from a template (manager/admin)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, createSession, listSessions, getSession, updateSessionStatus, generateTodaySessions } from '@/lib/inventory-db';

initInventoryTables();

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') as any;
  const templateId = searchParams.get('template_id');
  const locationId = searchParams.get('location_id');

  // Staff only see sessions assigned to them; managers/admins see all
  const isStaff = !hasRole(user, 'manager');

  const sessions = listSessions({
    status: status || undefined,
    template_id: templateId ? parseInt(templateId) : undefined,
    location_id: locationId ? parseInt(locationId) : undefined,
    assigned_user_id: isStaff ? user.id : undefined,
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
    return NextResponse.json({ ...result, message: `Generated ${result.created} sessions (${result.skipped} already existed)` });
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
  const { id, status, review_note } = body;
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

  // Staff can submit, managers can approve/reject
  if (['approved', 'rejected'].includes(status) && !hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  updateSessionStatus(id, status, { reviewed_by: user.id, review_note });
  return NextResponse.json({ message: `Session ${status}` });
}

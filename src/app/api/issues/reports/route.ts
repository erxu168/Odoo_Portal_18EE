/**
 * /api/issues/reports
 *
 * NOTE: URL path is /api/issues/reports for backward-compat with mockup wiring.
 * Internally it operates on 'issues' (staff-submitted reports).
 * Not to be confused with /api/reports (analytics module).
 *
 * GET  — list issues with filters (type, status, location, mine)
 * POST — create a new issue (any authenticated user)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initIssuesTables, createIssue, listIssues } from '@/lib/issues-db';
import { logAudit } from '@/lib/db';
import type { IssueType, IssueStatus } from '@/types/issues';

initIssuesTables();

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') as IssueType | null;
  const status = searchParams.get('status') as IssueStatus | null;
  const location = searchParams.get('location');
  const mine = searchParams.get('mine') === '1';
  const restrictedOnly = searchParams.get('restricted') === '1';
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  const isManager = hasRole(user, 'manager');

  if (restrictedOnly && !isManager) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const issues = listIssues({
    type: type || undefined,
    status: status || undefined,
    location: location || undefined,
    reporter_id: mine ? user.id : undefined,
    restricted_only: restrictedOnly || undefined,
    exclude_restricted: !isManager && !mine ? true : undefined,
    limit,
    offset,
  });

  return NextResponse.json({ issues });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { type, description, location, location_custom, department, urgency, equipment_text, type_data } = body;

  if (!type || !description || !location || !department) {
    return NextResponse.json({ error: 'type, description, location, department required' }, { status: 400 });
  }

  const validTypes: IssueType[] = ['repair', 'purchase_request', 'injury', 'security', 'food_safety', 'hazard', 'suggestion', 'other'];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: 'Invalid issue type' }, { status: 400 });
  }

  const id = createIssue(
    { type, description, location, location_custom, department, urgency, equipment_text, type_data: type_data || {} },
    user.id,
    user.name
  );

  logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'create_issue',
    module: 'issues',
    target_type: 'issue',
    detail: `Created ${type} issue: ${description.substring(0, 80)}`,
  });

  return NextResponse.json({ id, message: 'Issue created' }, { status: 201 });
}

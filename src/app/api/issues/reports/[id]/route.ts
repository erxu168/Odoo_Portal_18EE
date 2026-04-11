/**
 * /api/issues/reports/[id]
 *
 * GET — get issue detail (with type_data, media, comments)
 * PUT — update issue (assign, status, notes, link equipment)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import {
  initIssuesTables, getIssue, updateIssue, recordRepairCost,
  getMediaForIssue, getCommentsForIssue,
} from '@/lib/issues-db';
import { logAudit } from '@/lib/db';

initIssuesTables();

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const issue = getIssue(params.id);
  if (!issue) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Restricted visibility check: staff can only see their own restricted issues
  if (issue.restricted && issue.reporter_id !== user.id && !hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const media = getMediaForIssue(params.id);
  const comments = getCommentsForIssue(params.id);

  return NextResponse.json({ issue, media, comments });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const issue = getIssue(params.id);
  if (!issue) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json();
  const { status, assigned_to, priority, deadline, equipment_id, manager_notes, resolution, repair_cost, type_data } = body;

  const isManager = hasRole(user, 'manager');
  if (!isManager) {
    if (issue.assigned_to !== user.name && issue.reporter_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (assigned_to || priority || deadline || equipment_id || manager_notes) {
      return NextResponse.json({ error: 'Forbidden: manager action required' }, { status: 403 });
    }
  }

  updateIssue(params.id, {
    status, assigned_to, priority, deadline, equipment_id,
    manager_notes, resolution, repair_cost, type_data,
  });

  if (status === 'resolved' && repair_cost && repair_cost > 0) {
    recordRepairCost(params.id, repair_cost);
  }

  logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'update_issue',
    module: 'issues',
    target_type: 'issue',
    detail: `Updated issue ${params.id}: ${Object.keys(body).join(', ')}`,
  });

  return NextResponse.json({ message: 'Issue updated' });
}

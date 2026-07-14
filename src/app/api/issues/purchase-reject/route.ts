/**
 * /api/issues/purchase-reject
 *
 * POST — reject a purchase request with a reason
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initIssuesTables, getIssue, updateIssue } from '@/lib/issues-db';
import { logAudit } from '@/lib/db';

initIssuesTables();

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { issue_id, reason } = body;

  if (!issue_id) {
    return NextResponse.json({ error: 'issue_id required' }, { status: 400 });
  }

  const issue = getIssue(issue_id);
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  if (issue.type !== 'purchase_request') {
    return NextResponse.json({ error: 'Not a purchase request' }, { status: 400 });
  }

  updateIssue(issue_id, {
    status: 'rejected',
    manager_notes: reason || undefined,
    type_data: {
      rejected_by: user.id,
      rejected_reason: reason || 'No reason provided',
    } as Partial<import('@/types/issues').PurchaseRequestData>,
  });

  logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'reject_purchase_request',
    module: 'issues',
    target_type: 'issue',
    detail: `Rejected purchase request ${issue_id}: ${reason || 'no reason'}`,
  });

  return NextResponse.json({ message: 'Purchase request rejected', issue_id });
}

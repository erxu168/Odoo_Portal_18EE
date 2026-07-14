/**
 * /api/issues/purchase-approve
 *
 * POST — approve a purchase request. Marks issue as resolved.
 *        TODO: Once Purchase module integration is wired, also creates draft PO.
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
  const { issue_id, note } = body;

  if (!issue_id) {
    return NextResponse.json({ error: 'issue_id required' }, { status: 400 });
  }

  const issue = getIssue(issue_id);
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  if (issue.type !== 'purchase_request') {
    return NextResponse.json({ error: 'Not a purchase request' }, { status: 400 });
  }
  if (issue.status === 'resolved') {
    return NextResponse.json({ error: 'Already approved' }, { status: 400 });
  }

  updateIssue(issue_id, {
    status: 'resolved',
    manager_notes: note || undefined,
    type_data: {
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    } as Partial<import('@/types/issues').PurchaseRequestData>,
  });

  // TODO: Create draft PO in Purchase module (wire up with purchase-db.ts)

  logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'approve_purchase_request',
    module: 'issues',
    target_type: 'issue',
    detail: `Approved purchase request ${issue_id}: ${issue.title}`,
  });

  return NextResponse.json({
    message: 'Purchase request approved',
    issue_id,
  });
}

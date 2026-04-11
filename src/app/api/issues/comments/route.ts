/**
 * /api/issues/comments
 *
 * POST — add a comment to an issue
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initIssuesTables, addComment, getIssue } from '@/lib/issues-db';

initIssuesTables();

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { issue_id, text } = body;

  if (!issue_id || !text || !text.trim()) {
    return NextResponse.json({ error: 'issue_id and text required' }, { status: 400 });
  }

  const issue = getIssue(issue_id);
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });

  if (issue.restricted && issue.reporter_id !== user.id && !hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = addComment(issue_id, user.id, user.name, text.trim());
  return NextResponse.json({ id, message: 'Comment added' }, { status: 201 });
}

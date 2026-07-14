/**
 * /api/issues/feed
 *
 * GET — location feed (respects restricted visibility per role)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initIssuesTables, getLocationFeed } from '@/lib/issues-db';

initIssuesTables();

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const location = searchParams.get('location') || 'SSAM';

  const issues = getLocationFeed(location, user.id, user.role);

  // Count restricted issues the user can't see (for the "X restricted" indicator)
  const restrictedHiddenCount = user.role === 'staff'
    ? issues.filter(i => i.restricted && i.reporter_id !== user.id).length
    : 0;

  const visibleIssues = user.role === 'staff'
    ? issues.filter(i => !i.restricted || i.reporter_id === user.id)
    : issues;

  return NextResponse.json({
    issues: visibleIssues,
    restricted_hidden: restrictedHiddenCount,
    location,
  });
}

/**
 * /api/issues/dashboard
 *
 * GET — badge counts + recent issues for module dashboard
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initIssuesTables, getDashboardData } from '@/lib/issues-db';

initIssuesTables();

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const location = searchParams.get('location') || 'SSAM';

  const data = getDashboardData(user.id, user.role, location);
  return NextResponse.json(data);
}

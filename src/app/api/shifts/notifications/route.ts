/**
 * GET /api/shifts/notifications?company_id=
 *
 * The viewer's in-app shift notifications for the active company, newest
 * first (payload already carries the slot summary + names, so the list
 * renders without extra fetches). Also returns the unread count for badges.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listNotifications } from '@/lib/shifts-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const companyId = parseInt(searchParams.get('company_id') || '', 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  }
  if (user.role !== 'admin' && !parseCompanyIds(user.allowed_company_ids).includes(companyId)) {
    return NextResponse.json({ error: 'You do not have access to this company' }, { status: 403 });
  }
  if (user.employee_id === null) {
    return NextResponse.json(
      { error: 'Your account is not linked to an employee record' },
      { status: 400 },
    );
  }

  try {
    const notifications = listNotifications(user.employee_id, 100)
      .filter(n => n.companyId === companyId)
      .slice(0, 50);
    const unreadCount = notifications.filter(n => n.readAt === null).length;
    return NextResponse.json({ notifications, unreadCount });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] notifications failed: ${msg}`);
    return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 });
  }
}

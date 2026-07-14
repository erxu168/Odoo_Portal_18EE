/**
 * POST /api/shifts/notifications/read  { ids: number[] }
 *
 * Marks the viewer's own notifications as read. The update is scoped to the
 * viewer's employee_id in the DB layer, so foreign ids are silently ignored.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { markNotificationsRead } from '@/lib/shifts-db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.employee_id === null) {
    return NextResponse.json(
      { error: 'Your account is not linked to an employee record' },
      { status: 400 },
    );
  }

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: 'ids must be an array' }, { status: 400 });
  }
  const ids = body.ids
    .map(v => (typeof v === 'number' ? v : parseInt(String(v), 10)))
    .filter(v => Number.isInteger(v) && v > 0);

  try {
    markNotificationsRead(user.employee_id, ids);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] notifications read failed: ${msg}`);
    return NextResponse.json({ error: 'Could not update notifications' }, { status: 500 });
  }
}

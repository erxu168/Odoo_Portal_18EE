/**
 * /api/admin/registrations
 *
 * GET    — list users by status (default: pending)
 * POST   — approve or reject a registration
 *
 * POST body:
 *   { user_id: number, action: 'approve' | 'reject' | 'clear_rejection', role?: string }
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { listUsersByStatus, countUsersByStatus, updateUser, getUserById, logAudit } from '@/lib/db';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'pending';

  const users = listUsersByStatus(status);
  const pendingCount = countUsersByStatus('pending');

  return NextResponse.json({ users, pending_count: pendingCount });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { user_id, action, role } = body;

  if (!user_id || !action) {
    return NextResponse.json({ error: 'user_id and action required' }, { status: 400 });
  }

  const target = getUserById(user_id);
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (action === 'approve') {
    if (!role) {
      return NextResponse.json({ error: 'role is required for approval' }, { status: 400 });
    }
    if (target.status !== 'pending') {
      return NextResponse.json({ error: 'User is not pending' }, { status: 400 });
    }
    updateUser(user_id, { status: 'active', role });
    logAudit({ user_id: user.id, user_name: user.name, action: 'approve_user', module: 'admin', target_type: 'user', target_id: user_id, detail: `Approved ${target.name} as ${role}` });
    return NextResponse.json({ message: `${target.name} approved as ${role}` });
  }

  if (action === 'reject') {
    if (target.status !== 'pending') {
      return NextResponse.json({ error: 'User is not pending' }, { status: 400 });
    }
    updateUser(user_id, { status: 'rejected' });
    logAudit({ user_id: user.id, user_name: user.name, action: 'reject_user', module: 'admin', target_type: 'user', target_id: user_id, detail: `Rejected ${target.name}` });
    return NextResponse.json({ message: `${target.name} rejected` });
  }

  if (action === 'clear_rejection') {
    if (target.status !== 'rejected') {
      return NextResponse.json({ error: 'User is not rejected' }, { status: 400 });
    }
    // Delete the user so they can re-register
    const { getDb } = await import('@/lib/db');
    const db = getDb();
    db.prepare('DELETE FROM portal_users WHERE id = ?').run(user_id);
    return NextResponse.json({ message: `Rejection cleared for ${target.name}. They can register again.` });
  }

  return NextResponse.json({ error: 'Invalid action. Use approve, reject, or clear_rejection.' }, { status: 400 });
}

/**
 * POST /api/shift/identify   { user_id, pin }
 * Verifies a staff member's PIN so their work can be credited on a shared
 * device, without a full login. Returns the person on success.
 */
import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { verifyUserPin, getUserById } from '@/lib/db';

export async function POST(request: Request) {
  try {
    requireAuth();
    const body = await request.json();
    const userId = parseInt(String(body.user_id), 10);
    const pin = String(body.pin || '');
    if (!userId || !pin) return NextResponse.json({ ok: false, error: 'user_id and pin required' }, { status: 400 });
    if (!verifyUserPin(userId, pin)) {
      return NextResponse.json({ ok: false, error: 'Wrong PIN' }, { status: 401 });
    }
    const u = getUserById(userId);
    if (!u) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, user: { id: u.id, name: u.name, employee_id: u.employee_id } });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

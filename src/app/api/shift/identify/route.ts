/**
 * POST /api/shift/identify   { user_id, company_id, pin }
 * Verifies a staff member's 4-digit PIN (the canonical clock-in PIN) so their work
 * can be credited on a shared device, without a full login. Company-scoped and
 * rate-limited — a correct PIN here also clocks the person in and logs into the
 * kitchen tablet, so this must never be an unthrottled guessing oracle.
 */
import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getUserById, parseCompanyIds } from '@/lib/db';
import { verifyKioskPin } from '@/lib/shifts-db';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const device = requireAuth();
    // Only a provisioned station (shared-device) account may identify people by PIN — the
    // same trust boundary as /api/station/pin-login. A personal account must never be able
    // to probe colleagues' canonical clock PINs.
    if (!device.is_shared_device) {
      return NextResponse.json({ ok: false, error: 'This screen only works on a station tablet.' }, { status: 403 });
    }
    const body = await request.json();
    const userId = parseInt(String(body.user_id), 10);
    const companyId = parseInt(String(body.company_id), 10);
    const pin = String(body.pin || '');
    if (!userId || !companyId) return NextResponse.json({ ok: false, error: 'user_id, company_id and pin required' }, { status: 400 });
    if (!/^\d{4}$/.test(pin)) return NextResponse.json({ ok: false, error: 'Enter your 4-digit PIN.' }, { status: 400 });
    // The station may only identify people in a restaurant it is assigned to.
    if (!parseCompanyIds(device.allowed_company_ids).includes(companyId)) {
      return NextResponse.json({ ok: false, error: 'This tablet is not set up for that restaurant.' }, { status: 403 });
    }

    // Brute-force cap keyed to the IMMUTABLE station account + company (not the target user
    // or a spoofable client IP), so it can't be sidestepped to guess canonical clock PINs.
    const rl = checkRateLimit(`shift-identify:${device.id}:${companyId}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'Too many tries — wait a moment.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const u = getUserById(userId);
    if (!u || !u.employee_id) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    // Preserve revocation: a deactivated/suspended or shared-device account can never be
    // identified by PIN, even if a clock PIN was left behind. (getUserById is state-agnostic.)
    if (!u.active || u.status !== 'active' || u.is_shared_device) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    // The target must belong to the requested company (admins are cross-company).
    if (u.role !== 'admin' && !parseCompanyIds(u.allowed_company_ids).includes(companyId)) {
      return NextResponse.json({ ok: false, error: 'Not on this restaurant' }, { status: 403 });
    }
    if (!verifyKioskPin(companyId, u.employee_id, pin)) {
      return NextResponse.json({ ok: false, error: 'Wrong PIN' }, { status: 401 });
    }
    return NextResponse.json({ ok: true, user: { id: u.id, name: u.name, employee_id: u.employee_id } });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

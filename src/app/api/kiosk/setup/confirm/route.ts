/**
 * POST /api/kiosk/setup/confirm  (PUBLIC — device kiosk, no login)
 * Body: { company_id, employee_id, code, pin }. Verifies the emailed 6-digit setup
 * code, sets the chosen 4-digit PIN, then clocks the person IN. Returns the punch
 * result on success (so the tablet shows the normal confirmation), or { ok, pinSet }
 * if the PIN was set but the clock-in couldn't run.
 */
import { NextResponse } from 'next/server';
import { verifyKioskSetupCode, setKioskPin, hasKioskPin } from '@/lib/shifts-db';
import { kioskPunch } from '@/lib/shifts-kiosk';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = parseInt(String(body.company_id ?? ''), 10);
    const employeeId = parseInt(String(body.employee_id ?? ''), 10);
    const code = typeof body.code === 'string' ? body.code : '';
    const pin = typeof body.pin === 'string' ? body.pin : '';

    if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be exactly 4 digits.' }, { status: 400 });
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the 6-digit code from your email.' }, { status: 400 });
    }

    // Blunt code brute-force: max 5 attempts / minute per (company, employee, ip).
    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`kiosk-setup-confirm:${companyId}:${employeeId}:${ip}`, 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    if (hasKioskPin(companyId, employeeId)) {
      return NextResponse.json({ error: 'You already have a PIN — enter it to clock in.' }, { status: 400 });
    }
    if (!verifyKioskSetupCode(companyId, employeeId, code)) {
      return NextResponse.json({ error: 'That code is wrong or expired.' }, { status: 401 });
    }

    setKioskPin(companyId, employeeId, pin);

    // Clock them in right away (they came to punch). The PIN is already saved, so if the
    // clock-in fails for ANY reason (business error or a thrown Odoo error), still report
    // success — the person just taps their name to punch. Never claim "couldn't set PIN".
    try {
      const result = await kioskPunch(companyId, employeeId);
      if (result.ok) return NextResponse.json(result);
    } catch (e) {
      console.error('[kiosk] setup/confirm: PIN set but clock-in failed:', e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ ok: true, pinSet: true });
  } catch (err: unknown) {
    console.error('[kiosk] setup/confirm error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not set your PIN — try again.' }, { status: 500 });
  }
}

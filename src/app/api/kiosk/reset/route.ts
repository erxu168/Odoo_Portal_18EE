/**
 * POST /api/kiosk/reset  (PUBLIC — behind a one-time email token)
 * Body: { token, pin }. Sets a new 4-digit PIN for the employee the reset token
 * belongs to, then consumes the token. Used by the /kiosk/reset-pin page.
 */
import { NextResponse } from 'next/server';
import { redeemKioskPinResetToken } from '@/lib/shifts-db';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token : '';
    const pin = typeof body.pin === 'string' ? body.pin : '';

    if (!token) return NextResponse.json({ error: 'Missing reset token.' }, { status: 400 });
    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be exactly 4 digits.' }, { status: 400 });
    }

    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`kiosk-reset:${ip}`, 10, 600_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    // Claim the token + set the PIN atomically (one transaction) — concurrent workers
    // can't double-use the one-time token.
    const result = redeemKioskPinResetToken(token, pin);
    if (!result.ok) {
      return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('[kiosk] reset error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not set your PIN — try again.' }, { status: 500 });
  }
}

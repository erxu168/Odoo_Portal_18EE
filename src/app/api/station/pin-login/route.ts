/**
 * POST /api/station/pin-login  { pin, company_id }
 * PIN-only identification on a shared kitchen tablet.
 *
 * The caller MUST already be the tablet's station account (is_shared_device) —
 * this endpoint never creates or elevates a session; it only tells the tablet
 * which person owns the entered PIN so the client can mark them as "acting".
 * Access scope stays whatever the station account allows (kitchen tools only).
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { findUserByPinInCompany } from '@/lib/station-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const device = getCurrentUser();
    if (!device || !device.is_shared_device) {
      return NextResponse.json({ error: 'This screen only works on a station tablet.' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const pin = typeof body.pin === 'string' ? body.pin : '';
    const companyId = Number(body.company_id);
    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: 'Enter your 4-digit PIN.' }, { status: 400 });
    }
    if (!companyId) {
      return NextResponse.json({ error: 'No restaurant set for this tablet.' }, { status: 400 });
    }

    // A tablet may only identify people in a restaurant it is assigned to.
    if (!parseCompanyIds(device.allowed_company_ids).includes(companyId)) {
      return NextResponse.json({ error: 'This tablet is not set up for that restaurant.' }, { status: 403 });
    }

    // Brute-force cap BEFORE any PIN check, so it also blocks the eventual correct
    // guess (not just wrong ones) and avoids running bcrypt when throttled. It is
    // IP-INDEPENDENT (keyed on tablet account + restaurant) so an attacker holding
    // the station session can't dodge it by rotating a spoofable X-Forwarded-For.
    // 10/min is generous for real shift-change sign-ins yet caps guessing hard.
    const rl = checkRateLimit(`station-pin:${device.id}:${companyId}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many tries — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const match = findUserByPinInCompany(companyId, pin);
    if (match.status === 'ok') {
      return NextResponse.json({ ok: true, user: match.user });
    }
    if (match.status === 'ambiguous') {
      return NextResponse.json({ error: 'That PIN is shared by more than one person — see a manager.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'PIN not recognised.' }, { status: 401 });
  } catch (err) {
    console.error('[station] pin-login error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Sign-in failed — try again.' }, { status: 500 });
  }
}

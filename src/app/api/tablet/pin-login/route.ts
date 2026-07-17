/**
 * POST /api/tablet/pin-login  { user_id, pin }
 * Staff sign-in on a provisioned shared tablet — tap your NAME then enter your PIN,
 * no email/password. The device token (kw_tablet) identifies the restaurant + its
 * station account; verifying the SELECTED person's PIN signs the tablet in AS the
 * (staff-level, kitchen-only) station account and mints the tamper-proof acting
 * token for that person.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getStationDevice, getUserById, createTabletSession, createStationActor,
  recordDeviceLoginFailure, clearDeviceLoginFailures, parseCompanyIds,
} from '@/lib/db';
import { COOKIE_NAME } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/csrf';
import { verifyStationPersonPin } from '@/lib/station-auth';

export const dynamic = 'force-dynamic';
const ACTOR_TTL_MS = 12 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request blocked.' }, { status: 403 });

    const token = cookies().get('kw_tablet')?.value;
    const device = token ? getStationDevice(token) : null;
    if (!device) {
      return NextResponse.json({ error: 'This tablet isn’t set up yet. Ask a manager.' }, { status: 403 });
    }
    if (device.disabled) {
      return NextResponse.json({ error: 'This tablet is turned off. Ask a manager to turn it back on.' }, { status: 403 });
    }

    // Persistent lockout (survives restarts, unlike the in-memory limiter).
    if (device.locked_until && new Date(device.locked_until).getTime() > Date.now()) {
      return NextResponse.json({ error: 'Too many wrong PINs — try again in a few minutes.' }, { status: 429 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const pin = typeof body.pin === 'string' ? body.pin : '';
    const userId = Number.parseInt(String(body.user_id ?? ''), 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: 'Tap your name first.' }, { status: 400 });
    }
    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: 'Enter your 4-digit PIN.' }, { status: 400 });
    }

    // In-memory per-device cap (cheap first line).
    const rl = checkRateLimit(`tablet-pin:${device.id}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many tries — wait a moment.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    // Validate the station account BEFORE checking the PIN, so an invalid station
    // returns the same 403 for any PIN (no PIN-validity oracle). It must still be
    // active + a staff-level shared-device account limited to exactly this one
    // restaurant — so a later change can never let an old token mint an elevated
    // or cross-company session.
    const station = getUserById(device.station_user_id);
    const stationCompanies = station ? parseCompanyIds(station.allowed_company_ids) : [];
    if (
      !station || !station.active || station.status !== 'active' ||
      !station.is_shared_device || station.role !== 'staff' ||
      stationCompanies.length !== 1 || stationCompanies[0] !== device.company_id
    ) {
      return NextResponse.json({ error: 'This tablet’s account is unavailable. Ask a manager to set it up again.' }, { status: 403 });
    }

    // Verify the SELECTED person's PIN. The restaurant comes only from the trusted
    // device record, never the client.
    const match = verifyStationPersonPin(device.company_id, userId, pin);
    if (match.status !== 'ok') {
      // Count toward the per-DEVICE lockout (never per selected name — else an
      // attacker rotates names for a fresh budget) and return a GENERIC error for
      // both an invalid selection and a wrong PIN, so it can't be used as an oracle.
      recordDeviceLoginFailure(device.id);
      return NextResponse.json({ error: 'PIN not recognised.' }, { status: 401 });
    }
    clearDeviceLoginFailures(device.id);

    // Sign in AS the station account: atomically replace any prior session for this
    // device (one session per device — also invalidates a copied token's session),
    // then mint the acting token bound to the new session for the person. Returns
    // null if the device was disabled/removed mid-request.
    const sessionToken = createTabletSession(station.id, device.id);
    if (!sessionToken) {
      return NextResponse.json({ error: 'This tablet is turned off. Ask a manager.' }, { status: 403 });
    }
    const actorToken = createStationActor(sessionToken, station.id, match.user.id, match.user.employee_id ?? null, device.company_id, ACTOR_TTL_MS);

    const secure = process.env.NODE_ENV === 'production';
    const res = NextResponse.json({ ok: true, user: match.user, company_id: device.company_id });
    res.cookies.set(COOKIE_NAME, sessionToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 });
    res.cookies.set('kw_actor', actorToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACTOR_TTL_MS / 1000 });
    // Non-httpOnly so CompanyProvider (client) picks up the tablet's restaurant.
    res.cookies.set('kw_company_id', String(device.company_id), { secure, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 60 * 60 });
    return res;
  } catch (err) {
    console.error('[tablet] pin-login error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Sign-in failed — try again.' }, { status: 500 });
  }
}

/**
 * POST /api/station/pin-login  { user_id, pin }
 * Name-then-PIN identification on a shared kitchen tablet: the client sends the
 * SELECTED person (user_id) + their PIN; we verify that one person's PIN.
 *
 * The caller MUST already be the tablet's station account (is_shared_device) —
 * this endpoint never creates or elevates a session; it only tells the tablet
 * which person is acting so the client can mark them as "acting". The restaurant
 * comes ONLY from the trusted server side, never the client: the physical device
 * behind the session if this is a provisioned tablet, else the station account's
 * own single allowed company (a station account is single-restaurant by design).
 * So a station account that later gains extra companies can never be used to mint
 * cross-company actors. Access scope stays whatever the station account allows.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentUser, COOKIE_NAME } from '@/lib/auth';
import { parseCompanyIds, createStationActor, getStationDeviceForSession } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/csrf';
import { verifyStationPersonPin } from '@/lib/station-auth';

const ACTOR_TTL_MS = 12 * 60 * 60 * 1000; // hard cap; idle sign-out clears it much sooner

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request blocked.' }, { status: 403 });

    const account = getCurrentUser();
    if (!account || !account.is_shared_device) {
      return NextResponse.json({ error: 'This screen only works on a station tablet.' }, { status: 403 });
    }

    // Restaurant + brute-force identity from the TRUSTED server side, never the client:
    // the provisioned device if there is one, else the account's single company. Requiring
    // a single company on the fallback path keeps a (mis)configured multi-company station
    // account from minting cross-company actors.
    const sessionToken = cookies().get(COOKIE_NAME)?.value || '';
    const device = getStationDeviceForSession(sessionToken);
    let companyId: number;
    let lockoutKey: string;
    if (device) {
      companyId = device.company_id;
      lockoutKey = `station-pin:dev:${device.id}`;
    } else {
      const companies = parseCompanyIds(account.allowed_company_ids);
      if (companies.length !== 1) {
        return NextResponse.json({ error: 'This tablet’s account isn’t set for one restaurant. Ask a manager.' }, { status: 403 });
      }
      companyId = companies[0];
      lockoutKey = `station-pin:acct:${account.id}`;
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

    // Brute-force cap BEFORE any PIN check, keyed on the tablet (device/account), not a
    // client value, so it also blocks the eventual correct guess and can't be dodged by a
    // spoofable X-Forwarded-For. 10/min is generous for real shift-change sign-ins.
    const rl = checkRateLimit(lockoutKey, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many tries — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    // Verify the SELECTED person's PIN (name-then-PIN). Generic failure so it can't
    // be used to probe account state or PIN validity.
    const match = verifyStationPersonPin(companyId, userId, pin);
    if (match.status !== 'ok') {
      return NextResponse.json({ error: 'PIN not recognised.' }, { status: 401 });
    }
    // Mint a server-stored acting token bound to THIS tablet LOGIN SESSION, and hand
    // it back as an httpOnly cookie. The client can't read or forge it, so attribution
    // can't be spoofed by editing a client cookie, and it dies with the session
    // (logout/relogin invalidates it).
    const token = createStationActor(sessionToken, account.id, match.user.id, match.user.employee_id ?? null, companyId, ACTOR_TTL_MS);
    const res = NextResponse.json({ ok: true, user: match.user });
    res.cookies.set('kw_actor', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ACTOR_TTL_MS / 1000,
    });
    return res;
  } catch (err) {
    console.error('[station] pin-login error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Sign-in failed — try again.' }, { status: 500 });
  }
}

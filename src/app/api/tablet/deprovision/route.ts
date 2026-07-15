/**
 * POST /api/tablet/deprovision  { email, password }
 * Manager "un-setup" of THIS tablet, run from the tablet itself. Revokes this
 * device's token and deletes this device's sessions (a copied cookie / lingering
 * session for it stops working), then clears its cookies. Other tablets for the
 * restaurant are unaffected. The manager must be active and allowed to manage the
 * device's restaurant. (Remote revoke of a lost tablet needs an admin screen —
 * a documented follow-up.)
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { getUserByEmail, parseCompanyIds, getStationDevice, revokeStationDevice, deleteSessionsForDevice, logAudit } from '@/lib/db';
import { hasRole, COOKIE_NAME } from '@/lib/auth';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';
const DUMMY_HASH = bcrypt.hashSync('tablet-timing-guard', 10);

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request blocked.' }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
    }

    const ip = clientIpFromHeaders(request.headers);
    const ipRl = checkRateLimit(`tablet-deprovision-ip:${ip}`, 5, 60_000);
    const emailRl = checkRateLimit(`tablet-deprovision-email:${email}`, 5, 60_000);
    if (!ipRl.allowed || !emailRl.allowed) {
      const retry = Math.max(ipRl.retryAfterSec, emailRl.retryAfterSec);
      return NextResponse.json({ error: 'Too many tries — wait a moment.' }, { status: 429, headers: { 'Retry-After': String(retry) } });
    }

    const deviceToken = cookies().get('kw_tablet')?.value;
    const device = deviceToken ? getStationDevice(deviceToken) : null;
    if (!device) {
      return NextResponse.json({ error: 'No tablet setup was found on this device.' }, { status: 400 });
    }

    const user = getUserByEmail(email);
    const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordOk) {
      return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 });
    }
    if (user.status !== 'active') {
      return NextResponse.json({ error: 'This account is not active.' }, { status: 403 });
    }
    if (!hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Only managers can remove a tablet setup.' }, { status: 403 });
    }
    if (user.role !== 'admin' && !parseCompanyIds(user.allowed_company_ids).includes(device.company_id)) {
      return NextResponse.json({ error: 'You can’t manage this restaurant’s tablet.' }, { status: 403 });
    }

    // Remove THIS tablet only: revoke its device token + delete its sessions
    // (a copied cookie / lingering session for this device stops working). Other
    // tablets for the restaurant are unaffected.
    if (deviceToken) revokeStationDevice(deviceToken);
    deleteSessionsForDevice(device.id);
    logAudit({ user_id: user.id, user_name: user.name, action: 'tablet_deprovisioned', module: 'tablet', detail: `company=${device.company_id}` });

    const res = NextResponse.json({ ok: true });
    for (const name of ['kw_tablet', COOKIE_NAME, 'kw_actor']) {
      res.cookies.set(name, '', { httpOnly: true, path: '/', maxAge: 0, sameSite: 'lax' });
    }
    // kw_company_id is non-httpOnly (client-read) — clear it too so the removed
    // tablet's restaurant doesn't leak into the next normal login on this device.
    res.cookies.set('kw_company_id', '', { path: '/', maxAge: 0, sameSite: 'lax' });
    return res;
  } catch (err) {
    console.error('[tablet] deprovision error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed — try again.' }, { status: 500 });
  }
}

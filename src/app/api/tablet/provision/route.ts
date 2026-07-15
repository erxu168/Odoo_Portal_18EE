/**
 * POST /api/tablet/provision  { email, password, company_id? }
 * One-time manager setup of a shared kitchen tablet.
 *   - no company_id: verify manager creds → return the restaurants they may set up.
 *   - company_id:    verify + provision → issue a long-lived httpOnly kw_tablet
 *                    device token bound to that restaurant's station account.
 * The station account must be a single-restaurant, staff-level, is_shared_device
 * account and unique for the company (never guess among several).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { getUserByEmail, parseCompanyIds, findStationAccountsForCompany, provisionStationDevice, revokeStationDevice, getStationDevice, deleteSessionsForDevice, deleteSession, logAudit } from '@/lib/db';
import { hasRole, COOKIE_NAME } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

// Compared against when the email is unknown so response timing doesn't reveal
// whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('tablet-timing-guard', 10);

interface OdooCompany { id: number; name: string; sequence?: number }

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request blocked.' }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const companyId = body.company_id != null ? Number(body.company_id) : null;
    if (!email || !password) {
      return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
    }

    const ip = clientIpFromHeaders(request.headers);
    const ipRl = checkRateLimit(`tablet-provision-ip:${ip}`, 5, 60_000);
    const emailRl = checkRateLimit(`tablet-provision-email:${email}`, 5, 60_000);
    if (!ipRl.allowed || !emailRl.allowed) {
      const retry = Math.max(ipRl.retryAfterSec, emailRl.retryAfterSec);
      return NextResponse.json({ error: 'Too many tries — wait a moment.' }, { status: 429, headers: { 'Retry-After': String(retry) } });
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
      return NextResponse.json({ error: 'Only managers can set up a tablet.' }, { status: 403 });
    }

    // Restaurants this manager may set the tablet for (admins: all).
    const companies = (await getOdoo().searchRead(
      'res.company', [], ['id', 'name', 'sequence'], { limit: 200, order: 'sequence asc, id asc' },
    )) as OdooCompany[];
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const scoped = user.role === 'admin' ? companies : companies.filter(c => allowed.includes(c.id));
    const list = scoped.map(c => ({ id: c.id, name: c.name }));

    if (!companyId) {
      return NextResponse.json({ ok: true, step: 'pick', name: user.name, companies: list });
    }

    const chosen = list.find(c => c.id === companyId);
    if (!chosen) {
      return NextResponse.json({ error: 'You can’t set up a tablet for that restaurant.' }, { status: 403 });
    }

    // The station account must be unique, staff-level and single-restaurant, so a
    // PIN can never yield elevated privileges or cross-company access.
    const stations = findStationAccountsForCompany(companyId);
    if (stations.length === 0) {
      return NextResponse.json({ error: 'No tablet account exists for this restaurant yet. Ask an admin to create one.' }, { status: 400 });
    }
    if (stations.length > 1) {
      return NextResponse.json({ error: 'More than one tablet account exists for this restaurant — ask an admin to fix that first.' }, { status: 400 });
    }
    const station = stations[0];
    if (station.role !== 'staff') {
      return NextResponse.json({ error: 'The tablet account must be a staff-level account, not a manager/admin.' }, { status: 400 });
    }
    const stationCompanies = parseCompanyIds(station.allowed_company_ids);
    if (stationCompanies.length !== 1 || stationCompanies[0] !== companyId) {
      return NextResponse.json({ error: 'The tablet account must be limited to just this one restaurant.' }, { status: 400 });
    }

    // Clean re-setup: fully retire any token already on THIS device — delete ALL of
    // its sessions (not just this browser's) and revoke it — before issuing a new one.
    const cookieStore = cookies();
    const prior = cookieStore.get('kw_tablet')?.value;
    if (prior) {
      const oldDevice = getStationDevice(prior);
      if (oldDevice) deleteSessionsForDevice(oldDevice.id);
      revokeStationDevice(prior);
    }
    // Also drop any non-tablet session already in this browser so the freshly-shared
    // tablet starts at the PIN pad and can't retain a previous person's login.
    const oldSession = cookieStore.get(COOKIE_NAME)?.value;
    if (oldSession) deleteSession(oldSession);

    const token = provisionStationDevice(station.id, companyId, chosen.name, user.name);
    logAudit({ user_id: user.id, user_name: user.name, action: 'tablet_provisioned', module: 'tablet', detail: `company=${chosen.name}` });

    const secure = process.env.NODE_ENV === 'production';
    const res = NextResponse.json({ ok: true, step: 'done', company_id: companyId, company_name: chosen.name });
    res.cookies.set('kw_tablet', token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 60 * 60 });
    for (const name of [COOKIE_NAME, 'kw_actor']) {
      res.cookies.set(name, '', { httpOnly: true, path: '/', maxAge: 0, sameSite: 'lax' });
    }
    return res;
  } catch (err) {
    console.error('[tablet] provision error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Setup failed — try again.' }, { status: 500 });
  }
}

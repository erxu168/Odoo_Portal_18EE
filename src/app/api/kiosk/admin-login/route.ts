/**
 * POST /api/kiosk/admin-login  (kiosk device — unlocks the on-tablet settings)
 * Body: { email, password }.
 *
 * Verifies portal credentials AND that the user's role is manager or admin, then
 * returns the companies that user may configure this tablet for.
 *
 * IMPORTANT: this deliberately does NOT create a portal session or set any cookie.
 * A shared kiosk must never be left logged in — the unlock is one-shot and lives
 * only in the browser tab's memory for the current settings visit.
 */
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByEmail, parseCompanyIds, logAudit } from '@/lib/db';
import { hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

interface OdooCompany {
  id: number;
  name: string;
  sequence?: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
    }

    // Brute-force defense. The IP bucket is a blunt first pass, but on this public
    // endpoint X-Forwarded-For is client-settable and can be rotated per request,
    // so it alone is spoofable. The per-EMAIL bucket is the real cap: it limits
    // password guesses against any single account regardless of source IP.
    const ip = clientIpFromHeaders(request.headers);
    const ipRl = checkRateLimit(`kiosk-admin-login-ip:${ip}`, 5, 60_000);
    const emailRl = checkRateLimit(`kiosk-admin-login-email:${email}`, 5, 60_000);
    if (!ipRl.allowed || !emailRl.allowed) {
      const retry = Math.max(ipRl.retryAfterSec, emailRl.retryAfterSec);
      return NextResponse.json(
        { error: 'Too many tries — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(retry) } },
      );
    }

    const user = getUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 });
    }
    if (user.status !== 'active') {
      return NextResponse.json({ error: 'This account is not active.' }, { status: 403 });
    }
    if (!hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Only managers can change settings.' }, { status: 403 });
    }

    // Companies this user may configure the tablet for: admins see all; managers
    // see only their assigned companies (matches /api/companies semantics).
    const odoo = getOdoo();
    const companies = (await odoo.searchRead(
      'res.company', [], ['id', 'name', 'sequence'],
      { limit: 50, order: 'sequence asc, id asc' },
    )) as OdooCompany[];
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const scoped = user.role === 'admin' ? companies : companies.filter(c => allowed.includes(c.id));
    const list = scoped.map(c => ({ id: c.id, name: c.name }));

    logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'kiosk_settings_unlock',
      module: 'kiosk',
      detail: `role=${user.role}`,
    });

    return NextResponse.json({ ok: true, name: user.name, role: user.role, companies: list });
  } catch (err: unknown) {
    console.error('[kiosk] admin-login error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Sign-in failed — try again.' }, { status: 500 });
  }
}

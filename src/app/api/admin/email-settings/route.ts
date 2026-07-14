/**
 * GET  /api/admin/email-settings?company_id=  — one company's SMTP settings.
 * PUT  /api/admin/email-settings               — save them.
 *
 * Admin only. company_id = 0 is the shared "Default (all restaurants)" fallback.
 * The password is never returned to the client (only a passwordSet flag); on
 * save, an empty password leaves the stored one unchanged.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getCompanySettings, setCompanySetting } from '@/lib/db';
import { getEmailConfig } from '@/lib/email';

export const dynamic = 'force-dynamic';

function adminOnly() {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const gate = adminOnly();
  if (gate) return gate;
  try {
    const { searchParams } = new URL(request.url);
    const companyId = parseInt(searchParams.get('company_id') || '0', 10);
    if (!Number.isInteger(companyId) || companyId < 0) {
      return NextResponse.json({ error: 'Invalid company_id' }, { status: 400 });
    }
    const own = getCompanySettings(companyId);
    const eff = getEmailConfig(companyId); // resolved (own → default → env), password masked
    return NextResponse.json({
      companyId,
      // this company's own saved values (blank = inherits the default/env)
      host: own.smtp_host || '',
      port: own.smtp_port || '',
      secure: own.smtp_secure || '',
      user: own.smtp_user || '',
      from: own.smtp_from || '',
      passwordSet: !!own.smtp_password,
      // what actually gets used after fallback (helps show inheritance)
      effective: {
        host: eff.host,
        port: eff.port,
        secure: eff.secure,
        user: eff.user,
        from: eff.from,
        passwordSet: !!eff.pass,
      },
    });
  } catch (err: unknown) {
    console.error('GET /api/admin/email-settings error:', err);
    return NextResponse.json({ error: 'Failed to load email settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const gate = adminOnly();
  if (gate) return gate;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = Number(body.company_id);
    if (!Number.isInteger(companyId) || companyId < 0) {
      return NextResponse.json({ error: 'Invalid company_id' }, { status: 400 });
    }
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const host = str(body.host);
    const portRaw = str(body.port);
    const port = portRaw && /^\d+$/.test(portRaw) ? portRaw : '';
    const secure = body.secure === true || body.secure === '1' || body.secure === 'ssl' ? '1' : '0';
    const user = str(body.user);
    const from = str(body.from);
    const password = typeof body.password === 'string' ? body.password : '';

    setCompanySetting(companyId, 'smtp_host', host);
    setCompanySetting(companyId, 'smtp_port', port);
    setCompanySetting(companyId, 'smtp_secure', secure);
    setCompanySetting(companyId, 'smtp_user', user);
    setCompanySetting(companyId, 'smtp_from', from);
    // Only overwrite the password when a new one is actually provided.
    if (password) setCompanySetting(companyId, 'smtp_password', password);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('PUT /api/admin/email-settings error:', err);
    return NextResponse.json({ error: 'Failed to save email settings' }, { status: 500 });
  }
}

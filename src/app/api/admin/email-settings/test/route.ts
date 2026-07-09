/**
 * POST /api/admin/email-settings/test  { company_id, to }
 * Sends a test email using the SAVED settings for that company (save first).
 * Admin only. Returns the SMTP error message on failure so it can be shown.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { sendTestEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request: Request) {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = Number(body.company_id);
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!Number.isInteger(companyId) || companyId < 0) {
      return NextResponse.json({ error: 'Invalid company_id' }, { status: 400 });
    }
    if (!EMAIL_RE.test(to)) {
      return NextResponse.json({ error: 'Enter a valid email address to send the test to.' }, { status: 400 });
    }
    await sendTestEmail(to, companyId || undefined);
    return NextResponse.json({ ok: true, message: `Test email sent to ${to}.` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('POST /api/admin/email-settings/test error:', msg);
    return NextResponse.json({ error: `Could not send: ${msg}` }, { status: 502 });
  }
}

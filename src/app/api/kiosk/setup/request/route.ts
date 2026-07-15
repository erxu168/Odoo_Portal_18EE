/**
 * POST /api/kiosk/setup/request  (PUBLIC — device kiosk, no login)
 * Body: { company_id, employee_id }. For a staff member who has NO PIN yet, emails
 * a 6-digit setup code to their work/private email. They type it back at the tablet
 * (see setup/confirm) to prove it's them, then choose their own PIN.
 */
import { NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { hasKioskPin, createKioskSetupCode } from '@/lib/shifts-db';
import { kioskEmployeeContact } from '@/lib/shifts-kiosk';
import { sendKioskSetupCodeEmail } from '@/lib/email';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return 'your email';
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  const shown = user.length <= 2 ? user[0] : user[0] + '*'.repeat(user.length - 2) + user[user.length - 1];
  return `${shown}@${domain}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = parseInt(String(body.company_id ?? ''), 10);
    const employeeId = parseInt(String(body.employee_id ?? ''), 10);
    if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    // Limit setup emails: max 5 / 10 min per (company, employee, ip).
    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`kiosk-setup-req:${companyId}:${employeeId}:${ip}`, 5, 600_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    if (hasKioskPin(companyId, employeeId)) {
      return NextResponse.json({ error: 'You already have a PIN — enter it, or use “Forgot PIN”.' }, { status: 400 });
    }

    const contact = await kioskEmployeeContact(companyId, employeeId);
    if (!contact) return NextResponse.json({ error: 'Unknown employee' }, { status: 404 });
    if (!contact.email) {
      return NextResponse.json(
        { error: 'No email is on file for you — ask a manager to set your PIN.' },
        { status: 400 },
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    createKioskSetupCode(companyId, employeeId, code);
    await sendKioskSetupCodeEmail(contact.email, contact.name, code, companyId);

    return NextResponse.json({ ok: true, emailMasked: maskEmail(contact.email) });
  } catch (err: unknown) {
    console.error('[kiosk] setup/request error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not send the setup code — try again.' }, { status: 500 });
  }
}

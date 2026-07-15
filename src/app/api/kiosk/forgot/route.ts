/**
 * POST /api/kiosk/forgot  (PUBLIC — device kiosk, no login)
 * Body: { company_id, employee_id }. Emails a one-time reset link to the staff
 * member's email; they open it on their phone (/kiosk/reset-pin?token=…) to choose
 * a new PIN.
 */
import { NextResponse } from 'next/server';
import { createKioskPinResetToken } from '@/lib/shifts-db';
import { kioskEmployeeContact } from '@/lib/shifts-kiosk';
import { sendKioskPinResetEmail } from '@/lib/email';
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

    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`kiosk-forgot:${companyId}:${employeeId}:${ip}`, 5, 600_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const contact = await kioskEmployeeContact(companyId, employeeId);
    if (!contact) return NextResponse.json({ error: 'Unknown employee' }, { status: 404 });
    if (!contact.email) {
      return NextResponse.json(
        { error: 'No email is on file for you — ask a manager to reset your PIN.' },
        { status: 400 },
      );
    }

    const token = createKioskPinResetToken(companyId, employeeId);
    await sendKioskPinResetEmail(contact.email, contact.name, token, companyId);

    return NextResponse.json({ ok: true, emailMasked: maskEmail(contact.email) });
  } catch (err: unknown) {
    console.error('[kiosk] forgot error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not send the reset link — try again.' }, { status: 500 });
  }
}

/**
 * Staff self-service kiosk PIN.
 *   GET  /api/shifts/my-pin?company_id=6   -> { hasPin }
 *   POST /api/shifts/my-pin  { company_id, pin }  -> set (4 digits) or clear (empty)
 * Always scoped to the caller's own employee record.
 */
import { NextResponse } from 'next/server';
import { AuthError, requireAuth } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { employeesWithPin, setKioskPin } from '@/lib/shifts-db';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function resolve(companyRaw: unknown, user: { role: string; allowed_company_ids: string; employee_id: number | null }) {
  if (user.employee_id === null) {
    return { error: NextResponse.json({ error: 'No employee is linked to your account.' }, { status: 400 }) };
  }
  const companyId = parseInt(String(companyRaw ?? ''), 10);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return { error: NextResponse.json({ error: 'company_id is required' }, { status: 400 }) };
  }
  if (user.role !== 'admin' && !parseCompanyIds(user.allowed_company_ids).includes(companyId)) {
    return { error: NextResponse.json({ error: 'You do not have access to this company.' }, { status: 403 }) };
  }
  return { companyId, employeeId: user.employee_id };
}

export async function GET(request: Request) {
  try {
    const user = requireAuth();
    const { searchParams } = new URL(request.url);
    const r = resolve(searchParams.get('company_id'), user);
    if ('error' in r) return r.error;
    return NextResponse.json({ hasPin: employeesWithPin(r.companyId).has(r.employeeId) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[shifts] my-pin GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not load your PIN status' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = requireAuth();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const r = resolve(body.company_id, user);
    if ('error' in r) return r.error;
    const pin = typeof body.pin === 'string' ? body.pin : '';
    if (pin === '') {
      setKioskPin(r.companyId, r.employeeId, null);
      return NextResponse.json({ ok: true, cleared: true });
    }
    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be exactly 4 digits.' }, { status: 400 });
    }
    // Throttle PIN-setting per account (scrypt is CPU-heavy; blunts abuse). Keyed on the
    // account only (not a spoofable client IP) so rotating x-forwarded-for can't reset it.
    const rl = checkRateLimit(`my-pin-set:${user.id}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many tries — wait a moment.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }
    setKioskPin(r.companyId, r.employeeId, pin);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[shifts] my-pin POST error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not set your PIN' }, { status: 500 });
  }
}

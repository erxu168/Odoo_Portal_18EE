/**
 * POST /api/kiosk/punch  (PUBLIC — device kiosk, no login)
 * Body: { company_id, employee_id, pin }. Verifies the 4-digit PIN, then clocks
 * the employee IN or OUT (auto-detected) into Odoo hr.attendance.
 *
 * Security: device-trust + PIN. TODO before wide rollout: rate-limit by
 * (company, employee, ip) to blunt PIN brute-force, and consider a per-device token.
 */
import { NextResponse } from 'next/server';
import { verifyKioskPin } from '@/lib/shifts-db';
import { kioskPunch } from '@/lib/shifts-kiosk';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = parseInt(String(body.company_id ?? ''), 10);
    const employeeId = parseInt(String(body.employee_id ?? ''), 10);
    const pin = typeof body.pin === 'string' ? body.pin : '';

    if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    if (!/^\d{4}$/.test(pin) || !verifyKioskPin(companyId, employeeId, pin)) {
      return NextResponse.json({ error: 'Wrong PIN' }, { status: 401 });
    }

    const result = await kioskPunch(companyId, employeeId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('[kiosk] punch error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Clock action failed' }, { status: 500 });
  }
}

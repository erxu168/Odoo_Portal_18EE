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
import { kioskPunch, type KioskAction } from '@/lib/shifts-kiosk';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const ACTIONS: KioskAction[] = ['in', 'break', 'out', 'resume'];

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = parseInt(String(body.company_id ?? ''), 10);
    const employeeId = parseInt(String(body.employee_id ?? ''), 10);
    const pin = typeof body.pin === 'string' ? body.pin : '';
    // Absent action → infer from state (back-compat). Present-but-invalid → reject,
    // so a typo can't silently perform the wrong action (e.g. end a shift).
    let action: KioskAction | undefined;
    if (body.action !== undefined) {
      // Present (incl. null/empty/typo) → must be a known action; only a fully
      // absent field falls back to inference.
      if (!ACTIONS.includes(body.action as KioskAction)) {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      }
      action = body.action as KioskAction;
    }

    if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    // Blunt PIN brute-force: max 5 attempts / minute per (company, employee, ip).
    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`kiosk-punch:${companyId}:${employeeId}:${ip}`, 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    if (!/^\d{4}$/.test(pin) || !verifyKioskPin(companyId, employeeId, pin)) {
      return NextResponse.json({ error: 'Wrong PIN' }, { status: 401 });
    }

    const result = await kioskPunch(companyId, employeeId, action);
    if (!result.ok) return NextResponse.json({ error: result.error, state: result.state }, { status: 400 });
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('[kiosk] punch error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Clock action failed' }, { status: 500 });
  }
}

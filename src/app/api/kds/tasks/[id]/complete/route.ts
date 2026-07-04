/**
 * POST /api/kds/tasks/[id]/complete  (PUBLIC — no-login KDS device)
 * Body: { configId, employeeId, pin }. Verifies the employee's 4-digit clock-in
 * PIN, then marks the Task-Manager list line done in Odoo, credited to them.
 *
 * Security: device-trust + PIN, same model as /api/kiosk/punch. The company is
 * resolved server-side from configId (never a client-sent company_id), and the
 * endpoint is rate-limited to blunt PIN brute-force.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyKioskPin } from '@/lib/shifts-db';
import { completeLine } from '@/lib/odoo-tasks';
import { companyIdForConfig } from '@/lib/kds/company';
import { getOdoo } from '@/lib/odoo';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const taskLineId = parseInt(params.id, 10);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const configId = parseInt(String(body.configId ?? ''), 10);
    const employeeId = parseInt(String(body.employeeId ?? ''), 10);
    const pin = typeof body.pin === 'string' ? body.pin : '';

    if (!Number.isInteger(taskLineId) || taskLineId <= 0 || !Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const companyId = await companyIdForConfig(configId);
    if (!companyId) return NextResponse.json({ error: 'Unknown register' }, { status: 400 });

    // Blunt PIN brute-force: max 5 attempts / minute per (company, employee, ip).
    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`kds-task-complete:${companyId}:${employeeId}:${ip}`, 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts — wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    if (!/^\d{4}$/.test(pin) || !verifyKioskPin(companyId, employeeId, pin)) {
      return NextResponse.json({ error: 'Wrong PIN' }, { status: 401 });
    }

    // Scope the completion to this register's company — a valid company PIN must
    // not be usable to complete a task line belonging to a different company.
    const owned = await getOdoo().searchRead(
      'krawings.task.list.line',
      [['id', '=', taskLineId], ['list_id.company_id', '=', companyId]],
      ['id'], { limit: 1 },
    );
    if (!owned.length) {
      return NextResponse.json({ error: 'Task not found for this register' }, { status: 404 });
    }

    const result = await completeLine(taskLineId, employeeId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('[KDS] task complete error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not complete task' }, { status: 500 });
  }
}

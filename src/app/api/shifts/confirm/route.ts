/**
 * POST /api/shifts/confirm — confirm a shift ("I'll be there").
 * Body: { company_id, slot_id, employee_id? }.
 * - Staff: confirm their OWN published shift (no employee_id).
 * - Manager/admin of the company: confirm ON BEHALF of the assignee by passing
 *   employee_id (e.g. someone confirmed by phone). Audit-logged.
 */
import { NextResponse } from 'next/server';
import { AuthError, hasRole, requireAuth } from '@/lib/auth';
import { logAudit, parseCompanyIds } from '@/lib/db';
import { fetchSlot } from '@/lib/shifts-odoo';
import { confirmSlot } from '@/lib/shifts-db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = requireAuth();
    if (!user.employee_id) {
      return NextResponse.json({ error: 'No employee is linked to your account.' }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = parseInt(String(body.company_id ?? ''), 10);
    const slotId = parseInt(String(body.slot_id ?? ''), 10);
    if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(slotId) || slotId <= 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    const rawOnBehalf = body.employee_id === undefined ? null : parseInt(String(body.employee_id), 10);
    const onBehalfId = rawOnBehalf && Number.isInteger(rawOnBehalf) && rawOnBehalf > 0 && rawOnBehalf !== user.employee_id
      ? rawOnBehalf : null;

    const slot = await fetchSlot(slotId);
    if (!slot || slot.companyId !== companyId) {
      return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
    }
    if (slot.state !== 'published') {
      return NextResponse.json({ error: 'This shift is not published yet.' }, { status: 400 });
    }

    let confirmForEmployee: number;
    if (onBehalfId !== null) {
      // Manager confirming for a staffer.
      const canManage = hasRole(user, 'manager')
        && (user.role === 'admin' || parseCompanyIds(user.allowed_company_ids).includes(companyId));
      if (!canManage) {
        return NextResponse.json({ error: 'Only a manager can confirm for someone else.' }, { status: 403 });
      }
      if (slot.employeeId !== onBehalfId) {
        return NextResponse.json({ error: 'That shift is not assigned to that person.' }, { status: 403 });
      }
      confirmForEmployee = onBehalfId;
      logAudit({
        user_id: user.id,
        user_name: user.name || user.email,
        action: 'confirm_shift_on_behalf',
        module: 'shifts',
        target_type: 'planning.slot',
        target_id: slotId,
        detail: `Confirmed shift ${slotId} on behalf of employee ${onBehalfId}`,
      });
    } else {
      if (slot.employeeId !== user.employee_id) {
        return NextResponse.json({ error: 'That is not your shift.' }, { status: 403 });
      }
      confirmForEmployee = user.employee_id;
    }

    confirmSlot(slotId, companyId, confirmForEmployee);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[shifts] confirm error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not confirm the shift.' }, { status: 500 });
  }
}

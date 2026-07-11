/**
 * GET /api/shifts/unconfirmed?company_id= — manager board of assigned, published,
 * future shifts the staff member has NOT confirmed yet. Each row carries the
 * confirm-by cutoff, how many reminders were sent, and an overdue flag.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchFutureAssignedSlots } from '@/lib/shifts-odoo';
import { confirmedSlotIds, getShiftSettings, reminderStagesSent } from '@/lib/shifts-db';
import { confirmByMs } from '@/lib/shift-confirm';
import { odooToDate } from '@/lib/shifts-time';
import { requireManagerCompany, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const settings = getShiftSettings(companyId);
    const slots = await fetchFutureAssignedSlots(companyId);
    const confirmed = confirmedSlotIds(companyId);
    const now = Date.now();

    const shifts = slots
      .filter(s => !confirmed.has(s.id))
      .map(s => {
        const cutoffMs = confirmByMs(odooToDate(s.start).getTime(), settings.confirmByHours);
        return {
          slotId: s.id,
          employeeId: s.employeeId,
          employeeName: s.employeeName,
          start: s.start,
          end: s.end,
          roleName: s.roleName,
          departmentName: s.departmentName,
          confirmBy: new Date(cutoffMs).toISOString(),
          remindersSent: reminderStagesSent(s.id).length,
          overdue: now >= cutoffMs,
        };
      });

    return NextResponse.json({
      enabled: settings.requireConfirmation,
      shifts,
      overdueCount: shifts.filter(s => s.overdue).length,
    });
  } catch (err: unknown) {
    return serverError('unconfirmed board', err);
  }
}

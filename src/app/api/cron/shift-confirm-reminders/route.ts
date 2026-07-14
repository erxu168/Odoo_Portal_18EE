export const dynamic = 'force-dynamic';
/**
 * GET /api/cron/shift-confirm-reminders?token=<CRON_SECRET>&companies=6
 *
 * Drives shift-confirmation reminders for every company that has "require shift
 * confirmation" on: staff nudges (first, then a reminder near the cutoff) and a
 * one-time manager alert once a shift passes its confirm-by cutoff unconfirmed.
 * Each stage fires at most once per shift (shift_confirm_reminders). Run hourly:
 *
 *   0 * * * * curl -s "http://localhost:3000/api/cron/shift-confirm-reminders?token=$CRON_SECRET"
 */
import { NextResponse } from 'next/server';
import { fetchFutureAssignedSlots } from '@/lib/shifts-odoo';
import {
  companiesRequiringConfirmation,
  confirmedSlotIds,
  getShiftSettings,
  markReminderSent,
  reminderStagesSent,
} from '@/lib/shifts-db';
import { nextReminderStage } from '@/lib/shift-confirm';
import { notifyEmployee, notifyManagers } from '@/lib/shifts-notify';
import { fmtDay, fmtTimeRange, odooToDate } from '@/lib/shifts-time';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const secret = process.env.CRON_SECRET;
  if (secret && token !== secret) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const companiesParam = searchParams.get('companies');
  const companyIds = companiesParam
    ? companiesParam.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite)
    : companiesRequiringConfirmation();

  const now = Date.now();
  const sent = { first: 0, reminder: 0, overdue_mgr: 0 };

  for (const companyId of companyIds) {
    const settings = getShiftSettings(companyId);
    if (!settings.requireConfirmation) continue;

    const confirmed = confirmedSlotIds(companyId);
    let slots;
    try {
      slots = await fetchFutureAssignedSlots(companyId);
    } catch (err: unknown) {
      console.error(`[shifts] confirm-cron: slot fetch failed for company ${companyId}:`, err);
      continue;
    }

    for (const slot of slots) {
      if (slot.employeeId === null || confirmed.has(slot.id)) continue;
      const stage = nextReminderStage({
        startMs: odooToDate(slot.start).getTime(),
        nowMs: now,
        confirmByHours: settings.confirmByHours,
        sentStages: reminderStagesSent(slot.id),
        confirmed: false,
      });
      if (!stage) continue;

      const payload = { day: fmtDay(slot.start), time: fmtTimeRange(slot.start, slot.end), roleName: slot.roleName };
      try {
        if (stage === 'overdue_mgr') {
          await notifyManagers(companyId, 'confirm_overdue_mgr', {
            ...payload,
            message: `${slot.employeeName || 'A staff member'} has not confirmed`,
          });
        } else {
          await notifyEmployee(slot.employeeId, companyId, 'confirm_reminder', payload);
        }
        markReminderSent(slot.id, stage);
        sent[stage] += 1;
      } catch (err: unknown) {
        console.error(`[shifts] confirm-cron: notify failed for slot ${slot.id}:`, err);
      }
    }
  }

  return NextResponse.json({ ok: true, companies: companyIds.length, sent });
}

export const dynamic = 'force-dynamic';
/**
 * GET /api/cron/shift-confirm-reminders?token=<CRON_SECRET>&companies=6
 *
 * Drives shift-confirmation reminders for every company with "require shift
 * confirmation" on. Staff are nudged at up to three checkpoints — the evening
 * before, the morning of, and a final one a few hours before the shift — via
 * in-app + web push and (when enabled) an email carrying a one-tap confirm link,
 * resent at each checkpoint until they confirm. Independently, the manager is
 * alerted once a shift is still unconfirmed at its confirm-by cutoff. Quiet hours
 * suppress staff nudges. Each stage fires at most once per shift
 * (shift_confirm_reminders). Run hourly:
 *
 *   0 * * * * curl -s "http://localhost:3000/api/cron/shift-confirm-reminders?token=$CRON_SECRET"
 */
import { NextResponse } from 'next/server';
import { fetchFutureAssignedSlots, fetchEmployeeEmails } from '@/lib/shifts-odoo';
import {
  companiesRequiringConfirmation,
  confirmedSlotIds,
  getOrCreateShiftConfirmToken,
  getShiftSettings,
  markReminderSent,
  reminderStagesSent,
} from '@/lib/shifts-db';
import {
  inQuietWindow,
  managerOverdueDue,
  nextStaffCheckpoint,
  type ReminderCheckpoints,
} from '@/lib/shift-confirm';
import { notifyEmployee, notifyManagers } from '@/lib/shifts-notify';
import { sendShiftReminderEmail } from '@/lib/email';
import { berlinDateTimeToUtcOdoo, berlinParts, fmtDay, fmtTimeRange, nowOdooUtc, odooToDate } from '@/lib/shifts-time';
import type { ShiftSettings } from '@/types/shifts';

const H_MS = 3600e3;
const PORTAL_URL = process.env.PORTAL_URL || 'http://89.167.124.0:3000';

/** Berlin calendar date one day before the given "YYYY-MM-DD" (pure string math). */
function prevDateStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The three staff-nudge send times (epoch ms) for one shift, in Berlin wall clock. */
function computeCheckpoints(slotStartOdoo: string, startMs: number, s: ShiftSettings): ReminderCheckpoints {
  const { date } = berlinParts(slotStartOdoo);
  return {
    eveningMs: odooToDate(berlinDateTimeToUtcOdoo(prevDateStr(date), s.reminderEveningTime)).getTime(),
    morningMs: odooToDate(berlinDateTimeToUtcOdoo(date, s.reminderMorningTime)).getTime(),
    finalMs: startMs - s.reminderFinalLeadHours * H_MS,
  };
}

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

  const nowMs = Date.now();
  const nowHHMM = berlinParts(nowOdooUtc()).hhmm;
  const sent = { evening: 0, morning: 0, final: 0, overdue_mgr: 0, emails: 0 };

  for (const companyId of companyIds) {
    const settings = getShiftSettings(companyId);
    if (!settings.requireConfirmation) continue;

    const isQuietNow = inQuietWindow(nowHHMM, settings.reminderQuietStart, settings.reminderQuietEnd);

    const confirmed = confirmedSlotIds(companyId);
    let slots;
    try {
      slots = await fetchFutureAssignedSlots(companyId);
    } catch (err: unknown) {
      console.error(`[shifts] confirm-cron: slot fetch failed for company ${companyId}:`, err);
      continue;
    }

    const pending = slots.filter(s => s.employeeId !== null && !confirmed.has(s.id));

    // Batch-resolve staff emails once per company (only when email reminders are on).
    let emails = new Map<number, string>();
    if (settings.reminderEmailEnabled) {
      const empIds = Array.from(new Set(pending.map(s => s.employeeId as number)));
      try {
        emails = await fetchEmployeeEmails(empIds);
      } catch (err: unknown) {
        console.error(`[shifts] confirm-cron: email lookup failed for company ${companyId}:`, err);
      }
    }

    for (const slot of pending) {
      const employeeId = slot.employeeId as number;
      const startMs = odooToDate(slot.start).getTime();
      const sentStages = reminderStagesSent(slot.id);
      const payload = { day: fmtDay(slot.start), time: fmtTimeRange(slot.start, slot.end), roleName: slot.roleName };

      // -- Staff checkpoint (in-app + push always; email when enabled) -----------
      const stage = nextStaffCheckpoint({
        startMs,
        nowMs,
        checkpoints: computeCheckpoints(slot.start, startMs, settings),
        sentStages,
        confirmed: false,
        isQuietNow,
      });
      if (stage) {
        try {
          await notifyEmployee(employeeId, companyId, 'confirm_reminder', payload);

          if (settings.reminderEmailEnabled) {
            const email = emails.get(employeeId);
            if (email) {
              const expiresAt = new Date(startMs + 6 * H_MS).toISOString();
              const tok = getOrCreateShiftConfirmToken(slot.id, companyId, employeeId, expiresAt);
              const confirmUrl = `${PORTAL_URL}/confirm-shift?token=${tok}`;
              try {
                await sendShiftReminderEmail(email, slot.employeeName || 'there', payload, confirmUrl, companyId);
                sent.emails += 1;
              } catch (err: unknown) {
                console.error(`[shifts] confirm-cron: email send failed for slot ${slot.id}:`, err instanceof Error ? err.message : err);
              }
            }
          }

          markReminderSent(slot.id, stage);
          sent[stage] += 1;
        } catch (err: unknown) {
          console.error(`[shifts] confirm-cron: staff nudge failed for slot ${slot.id}:`, err);
        }
      }

      // -- Manager escalation (once, at confirm-by cutoff; independent of nudges) -
      if (managerOverdueDue({ startMs, nowMs, confirmByHours: settings.confirmByHours, sentStages, confirmed: false })) {
        try {
          await notifyManagers(companyId, 'confirm_overdue_mgr', {
            ...payload,
            message: `${slot.employeeName || 'A staff member'} has not confirmed`,
          });
          markReminderSent(slot.id, 'overdue_mgr');
          sent.overdue_mgr += 1;
        } catch (err: unknown) {
          console.error(`[shifts] confirm-cron: manager alert failed for slot ${slot.id}:`, err);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, companies: companyIds.length, sent });
}

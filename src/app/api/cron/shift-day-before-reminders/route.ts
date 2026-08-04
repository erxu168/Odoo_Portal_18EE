export const dynamic = 'force-dynamic';
/**
 * GET /api/cron/shift-day-before-reminders?token=<CRON_SECRET>&companies=6
 *
 * STANDALONE day-before shift reminder — independent of "require shift
 * confirmation". For every company with the toggle on, once during the one-hour
 * window that starts at its configured send time (default 18:00 Berlin), each
 * staff member assigned to a PUBLISHED shift TOMORROW gets ONE plain email
 * listing all their shifts that day (no confirm link/workflow). Delivery is
 * claimed atomically per employee+date so a double-run can't double-send. Staff
 * with no email on file are skipped and the manager(s) get one in-app warning.
 * Run hourly:
 *
 *   0 * * * * curl -s "http://localhost:3000/api/cron/shift-day-before-reminders?token=$CRON_SECRET"
 */
import { NextResponse } from 'next/server';
import { fetchEmployeeEmails, fetchFutureAssignedSlots } from '@/lib/shifts-odoo';
import { claimDayBeforeReminder, companiesWithDayBeforeReminder, getShiftSettings } from '@/lib/shifts-db';
import { notifyManagers } from '@/lib/shifts-notify';
import { sendDayBeforeShiftReminderEmail } from '@/lib/email';
import { berlinDateTimeToUtcOdoo, berlinISOWeekKey, berlinParts, fmtDay, fmtTimeRange, nowOdooUtc, odooToDate, weekKeyDays } from '@/lib/shifts-time';
import { addDaysStr, groupByEmployee, isDueNow, nextDateStr } from '@/lib/shift-day-before-reminder';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const secret = process.env.CRON_SECRET;
  // Fail CLOSED: this endpoint sends emails, so never run it without a configured secret.
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const companiesParam = searchParams.get('companies');
  const companyIds = companiesParam
    ? companiesParam.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite)
    : companiesWithDayBeforeReminder();

  const nowUtc = nowOdooUtc();
  const nowMs = odooToDate(nowUtc).getTime();
  const todayBerlin = berlinParts(nowUtc).date;
  const tomorrow = nextDateStr(todayBerlin);
  // "Upcoming days" section = the rest of this week + all of next week (day after
  // tomorrow → next week's Sunday), shown separately from the tomorrow reminder.
  const endOfNextWeek = addDaysStr(weekKeyDays(berlinISOWeekKey(`${todayBerlin} 12:00:00`))[6], 7);
  const result = { companies: 0, emailed: 0, noEmailWarned: 0 };

  for (const companyId of companyIds) {
    const settings = getShiftSettings(companyId);
    if (!settings.dayBeforeReminderEnabled) continue;

    // Fire only during the one-hour window opening at the configured Berlin time.
    const scheduledMs = odooToDate(berlinDateTimeToUtcOdoo(todayBerlin, settings.dayBeforeReminderTime)).getTime();
    if (!isDueNow(scheduledMs, nowMs)) continue;

    let slots;
    try {
      slots = await fetchFutureAssignedSlots(companyId);
    } catch (err: unknown) {
      console.error(`[shifts] day-before cron: slot fetch failed for company ${companyId}:`, err);
      continue;
    }

    // Published + assigned (already filtered by the helper) whose Berlin start date is tomorrow.
    const items = slots
      .filter(s => s.employeeId !== null && berlinParts(s.start).date === tomorrow)
      .map(s => ({
        employeeId: s.employeeId as number,
        employeeName: s.employeeName || '',
        startMs: odooToDate(s.start).getTime(),
        time: fmtTimeRange(s.start, s.end),
        roleName: s.roleName || '',
      }));
    if (items.length === 0) continue;

    // Each person's shifts for the upcoming days (day after tomorrow → next Sunday).
    const upcomingItems = slots
      .filter(s => {
        if (s.employeeId === null) return false;
        const d = berlinParts(s.start).date;
        return d > tomorrow && d <= endOfNextWeek;
      })
      .map(s => ({
        employeeId: s.employeeId as number,
        startMs: odooToDate(s.start).getTime(),
        dateStr: berlinParts(s.start).date,
        day: fmtDay(s.start),
        time: fmtTimeRange(s.start, s.end),
        roleName: s.roleName || '',
      }));
    const upcomingByEmployee = groupByEmployee(upcomingItems);

    const byEmployee = groupByEmployee(items);
    let emails = new Map<number, string>();
    try {
      emails = await fetchEmployeeEmails(Array.from(byEmployee.keys()));
    } catch (err: unknown) {
      // Never treat a lookup outage as "everyone has no email" — skip the company.
      console.error(`[shifts] day-before cron: email lookup failed for company ${companyId}:`, err);
      continue;
    }

    const dateLabel = fmtDay(`${tomorrow} 12:00:00`);
    const noEmail: { id: number; name: string }[] = [];
    result.companies += 1;

    for (const [employeeId, group] of Array.from(byEmployee.entries())) {
      const email = emails.get(employeeId);
      if (!email) {
        // Don't claim yet — claim only once the manager warning is dispatched, so a
        // notifyManagers failure (or an email added mid-window) stays retryable.
        noEmail.push({ id: employeeId, name: group[0].employeeName || `#${employeeId}` });
        continue;
      }
      // Claim BEFORE sending so a concurrent run can't double-send (SMTP failure after
      // the claim loses that one reminder — accepted; no auto-retry).
      if (!claimDayBeforeReminder(companyId, employeeId, tomorrow)) continue;
      // Group this person's upcoming shifts by day (each group already sorted by start).
      const upDays: { day: string; shifts: { time: string; roleName: string }[] }[] = [];
      let curDate = '';
      for (const it of upcomingByEmployee.get(employeeId) ?? []) {
        if (it.dateStr !== curDate) {
          curDate = it.dateStr;
          upDays.push({ day: it.day, shifts: [] });
        }
        upDays[upDays.length - 1].shifts.push({ time: it.time, roleName: it.roleName });
      }
      try {
        await sendDayBeforeShiftReminderEmail(
          email,
          group[0].employeeName,
          dateLabel,
          group.map(g => ({ time: g.time, roleName: g.roleName })),
          upDays,
          companyId,
        );
        result.emailed += 1;
      } catch (err: unknown) {
        console.error(`[shifts] day-before cron: email send failed for employee ${employeeId}:`, err);
      }
    }

    if (noEmail.length > 0) {
      try {
        await notifyManagers(companyId, 'shift_reminder_missing_email_mgr', {
          date: tomorrow,
          employeeNames: noEmail.map(n => n.name),
          count: noEmail.length,
          message: `No day-before reminder was emailed to ${noEmail.map(n => n.name).join(', ')} — no email on file.`,
        });
        // Only now claim them, so a warning failure above leaves them for the next run.
        for (const n of noEmail) claimDayBeforeReminder(companyId, n.id, tomorrow);
        result.noEmailWarned += noEmail.length;
      } catch (err: unknown) {
        console.error(`[shifts] day-before cron: manager warning failed for company ${companyId}:`, err);
      }
    }
  }

  return NextResponse.json({ ok: true, ...result });
}

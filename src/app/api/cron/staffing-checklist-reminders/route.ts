/**
 * GET /api/cron/staffing-checklist-reminders?token=<CRON_SECRET>
 *
 * Hourly. Sends a phone push for each checklist task whose deadline has reached a
 * new reminder stage (3 days before / due day / overdue). At-most-once: the stage
 * is CLAIMED atomically before sending, so concurrent runs never double-notify.
 * Quiet hours 09:00–21:00 Berlin. Run: 0 * * * * curl -s ".../?token=$CRON_SECRET"
 */
import { NextRequest, NextResponse } from 'next/server';
import { listReminderCandidates, claimReminderStage } from '@/lib/staffing-checklist-db';
import { reminderStageDue } from '@/lib/staffing-logic';
import { berlinToday } from '@/lib/berlin-date';
import { getUserByEmployeeId } from '@/lib/db';
import { sendPushToUser } from '@/lib/push';

function berlinHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(new Date()));
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'cron not configured' }, { status: 503 }); // fail closed
  if (new URL(req.url).searchParams.get('token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const hour = berlinHour();
  if (hour < 9 || hour >= 21) return NextResponse.json({ ok: true, sent: 0, skipped: 'quiet-hours' });

  const today = berlinToday();
  let sent = 0;
  for (const t of listReminderCandidates()) {
    const stageNow = reminderStageDue(t.due_date, today);
    if (stageNow <= t.reminder_stage) continue;
    // Claim FIRST — at-most-once, safe against concurrent runs. A missing
    // subscription still counts as claimed so we don't retry hourly.
    if (!claimReminderStage(t.id, stageNow)) continue;
    const userId = t.assignee_user_id
      ?? (t.assignee_employee_id != null ? getUserByEmployeeId(t.assignee_employee_id)?.id ?? null : null);
    if (userId == null) continue;
    const when = stageNow === 3 ? 'is overdue' : stageNow === 2 ? 'is due today' : 'is coming up';
    try {
      await sendPushToUser(userId, {
        title: 'Checklist task', body: `“${t.title}” ${when}.`,
        url: '/hr', tag: `staffing-${t.id}`,
      });
      sent++;
    } catch (err: unknown) { console.error('[staffing] reminder push failed', err); }
  }
  return NextResponse.json({ ok: true, sent });
}

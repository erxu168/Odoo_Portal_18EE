/**
 * GET /api/cron/task-overdue?token=<CRON_SECRET>
 *
 * The live overdue alert. Every 15 minutes: for each restaurant that runs task
 * lists, find today's tasks that are past due by more than the grace period and
 * still not done, and push ONE digest per department to that restaurant's
 * managers. Repeats hourly while anything is still outstanding, and stays
 * silent outside the restaurant's working day.
 *
 * Why a digest and not a ping per task: a busy opening can leave six tasks late
 * at once, and six notifications is how a manager learns to switch notifications
 * off. One per department is actionable; six is noise.
 *
 * At-most-once-per-window is enforced in Odoo, not here: portal_overdue_digest
 * stamps every task it returns before returning it, so a retry or an overlapping
 * run cannot report the same task twice.
 *
 * Crontab: "0,15,30,45 * * * * curl -s .../api/cron/task-overdue?token=$CRON_SECRET"
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { berlinToday } from '@/lib/berlin-date';
import { overdueDigest, activeServiceDates } from '@/lib/task-review';
import { notifyManagers } from '@/lib/shifts-notify';

export const dynamic = 'force-dynamic';

/** Minutes past a deadline before we say anything — a task being ticked off
 *  right on the hour should never buzz anyone. */
const GRACE_MINUTES = 15;
/** How long before the same task is reported again, while still outstanding. */
const REPEAT_MINUTES = 60;
/** Names listed in full before it becomes "+N more". */
const SHOW_NAMES = 3;

function berlinNowFloat(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return h + m / 60;
}

export async function GET(req: NextRequest) {
  // Identical guard to the summary cron — same secret, same fail-closed shape.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  if (new URL(req.url).searchParams.get('token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const odoo = getOdoo();
    const today = berlinToday();
    const nowFloat = berlinNowFloat();

    // Restaurants that actually run task lists — the same definition Settings uses.
    const depts = await odoo.searchRead(
      'hr.department',
      [['active', '=', true], ['company_id', '!=', false]],
      ['company_id'],
      { limit: 500 },
    );
    const companyIds = Array.from(new Set(
      (depts as { company_id: [number, string] }[]).map(d => d.company_id[0]),
    ));

    let considered = 0;
    let sent = 0;
    let quiet = 0;
    let failed = 0;

    for (const companyId of companyIds) {
      considered++;
      // Which service days are open right now. Tail = grace + one cron tick, so
      // the last tasks of the night are still reportable after the day ends —
      // and, for a restaurant that closes at midnight, that moment is on the
      // NEXT calendar date, which is why this returns dates rather than a
      // yes/no. An empty list is quiet hours.
      const openDates = await activeServiceDates(companyId, nowFloat, today, GRACE_MINUTES + 15);
      if (!openDates.length) { quiet++; continue; }

      const groups = await overdueDigest(companyId, GRACE_MINUTES, REPEAT_MINUTES, openDates);
      for (const g of groups) {
        if (!g.names.length) continue;
        // Each department is sent independently: the tasks are already stamped
        // as alerted, so one failing push must not take the rest of the
        // restaurant's departments down with it and lose them for an hour.
        try {
        const shown = g.names.slice(0, SHOW_NAMES);
        const extra = g.names.length - shown.length;
        const body = `${shown.join(', ')}${extra > 0 ? `, +${extra} more` : ''}`;
        await notifyManagers(companyId, 'task_overdue', {
          title: `${g.department_name} — ${g.names.length} task${g.names.length === 1 ? '' : 's'} overdue`,
          body,
          url: `/tasks/manager/dept/${g.department_id}`,
          // Per department + day, so a manager watching two departments gets
          // one line each rather than one collapsing over the other.
          // Keyed on the department + the day being chased, not the wall-clock
          // date: just after midnight the open day is still yesterday's, and
          // keying on "today" would start a second, competing tray line for the
          // same night's tasks.
          tag: `task-overdue-${g.department_id}-${openDates[openDates.length - 1]}`,
          // One tray line per department (that is the whole point of a digest),
          // but each update must actually alert — a same-tag replace is silent
          // by default, which made every repeat after the first one useless.
          renotify: true,
        });
        sent++;
        } catch (e) {
          failed++;
          console.error('[tasks] overdue push failed for department', g.department_id, e);
        }
      }
    }
    return NextResponse.json({ ok: true, considered, quiet, sent, failed });
  } catch (err) {
    console.error('[tasks] cron task-overdue error:', err);
    return NextResponse.json({ error: 'overdue run failed' }, { status: 500 });
  }
}

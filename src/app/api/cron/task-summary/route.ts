/**
 * GET /api/cron/task-summary?token=<CRON_SECRET>
 *
 * End-of-day summary: for each company with the summary ENABLED whose send time
 * (kw_task_summary_hour, Europe/Berlin) has arrived today and hasn't been sent
 * yet, push one recap (done / missed / photos to review) to that company's
 * managers. At-most-once per day: the company is CLAIMED atomically in Odoo
 * before sending, so overlapping runs never double-send.
 *
 * Run every 30 min so a 22:30 send time is hit promptly. Crontab (0,30 each
 * hour): "0,30 * * * * curl -s .../api/cron/task-summary?token=$CRON_SECRET".
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { berlinToday } from '@/lib/berlin-date';
import { getDaySummary, claimSummary } from '@/lib/task-review';
import { notifyManagers } from '@/lib/shifts-notify';

export const dynamic = 'force-dynamic';

function berlinHourFloat(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'cron not configured' }, { status: 503 }); // fail closed
  if (new URL(req.url).searchParams.get('token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const nowH = berlinHourFloat();
    const today = berlinToday();
    const companies = await getOdoo().searchRead(
      'res.company',
      [['kw_task_summary_enabled', '=', true]],
      ['id', 'name', 'kw_task_summary_hour'],
      { limit: 200 },
    );

    let considered = 0;
    let sent = 0;
    for (const c of companies as { id: number; name: string; kw_task_summary_hour: number }[]) {
      considered++;
      const hour = typeof c.kw_task_summary_hour === 'number' ? c.kw_task_summary_hour : 22.5;
      if (nowH < hour) continue;                          // not yet time today

      // Compute BEFORE claiming: an empty day (no list spawned yet) must NOT burn
      // the once-per-day claim, so a list created later can still be summarised.
      const s = await getDaySummary(c.id, today);
      if (s.total === 0) continue;                         // nothing to report yet

      if (!(await claimSummary(c.id, today))) continue;    // at-most-once per day

      const shown = s.missed_names.slice(0, 5);
      const missedText = s.missed_names.length
        ? `Missed: ${shown.join(', ')}${s.missed_names.length > shown.length ? `, +${s.missed_names.length - shown.length} more` : ''}.`
        : 'Nothing missed \u{1F389}.';
      const photoText = s.photos_to_review
        ? ` ${s.photos_to_review} photo${s.photos_to_review === 1 ? '' : 's'} to review.`
        : '';
      const body = `${s.done} of ${s.total} tasks done. ${missedText}${photoText}`;

      await notifyManagers(c.id, 'task_day_summary', {
        title: `${c.name} — end of day`,
        body,
        url: '/tasks/manager/review',
        // Per company + date, so a multi-company manager's recaps don't collapse
        // into one another on the device.
        tag: `task-summary-${c.id}-${today}`,
      });
      sent++;
    }
    return NextResponse.json({ ok: true, considered, sent });
  } catch (err) {
    console.error('[tasks] cron task-summary error:', err);
    return NextResponse.json({ error: 'summary run failed' }, { status: 500 });
  }
}

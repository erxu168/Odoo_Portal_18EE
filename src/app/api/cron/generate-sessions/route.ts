export const dynamic = 'force-dynamic';
/**
 * GET /api/cron/generate-sessions
 *
 * Auto-generates counting sessions for today from all active templates.
 * Designed to be called by system cron (e.g., daily at 06:00).
 *
 * Protected by a simple secret token to prevent unauthorized access.
 * Set CRON_SECRET in .env to enable.
 *
 * Usage:
 *   curl http://localhost:3000/api/cron/generate-sessions?token=YOUR_SECRET
 *
 * Crontab example:
 *   0 6 * * * curl -s http://localhost:3000/api/cron/generate-sessions?token=YOUR_SECRET
 */
import { NextResponse } from 'next/server';
import { initInventoryTables, generateTodaySessions, expireStaleSessions, todayStr } from '@/lib/inventory-db';
import { logAudit } from '@/lib/db';

export async function GET(request: Request) {
  initInventoryTables();

  // Auth: check token
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const secret = process.env.CRON_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  try {
    // Close yesterday BEFORE opening today, so the two never overlap and the
    // day's count is the only one waiting. Untouched counts only — anything
    // somebody actually counted in is left for a manager to deal with.
    const today = todayStr();
    const expired = expireStaleSessions(today);
    const result = generateTodaySessions();

    logAudit({
      action: 'cron_generate_sessions',
      module: 'inventory',
      detail: `Created ${result.created}, skipped ${result.skipped}, `
        + `closed ${expired.missed.length} untouched from earlier days`
        + (expired.leftAlone.length > 0
          ? `, left ${expired.leftAlone.length} part-counted alone (${expired.leftAlone.map((s) => s.scheduled_date).join(', ')})`
          : ''),
    });

    return NextResponse.json({
      ...result,
      missed: expired.missed.length,
      part_counted_left_open: expired.leftAlone,
      message: `Generated ${result.created} sessions (${result.skipped} already existed); `
        + `closed ${expired.missed.length} untouched count(s) from earlier days`
        + (expired.leftAlone.length > 0
          ? `; ${expired.leftAlone.length} part-counted count(s) left open for a manager`
          : ''),
    });
  } catch (error: any) {
    console.error('Cron generate-sessions error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

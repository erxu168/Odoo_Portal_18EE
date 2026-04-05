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
import { initInventoryTables, generateTodaySessions } from '@/lib/inventory-db';
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
    const result = generateTodaySessions();

    logAudit({
      action: 'cron_generate_sessions',
      module: 'inventory',
      detail: `Created ${result.created}, skipped ${result.skipped}`,
    });

    return NextResponse.json({
      ...result,
      message: `Generated ${result.created} sessions (${result.skipped} already existed)`,
    });
  } catch (error: unknown) {
    console.error('Cron generate-sessions error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

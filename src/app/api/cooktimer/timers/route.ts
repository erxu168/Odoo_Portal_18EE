import { NextResponse } from 'next/server';
import { getActiveTimers, getRecentDone, listStations } from '@/lib/cooktimer-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cooktimer/timers
 * Active timers + the recent "ready -> KDS" strip + active stations. Polled a
 * couple of times a second so a reloaded tablet (or a second tablet on the same
 * station) recovers exact state from step_started_at without touching Odoo.
 * `serverNow` lets the client correct for tablet clock skew.
 */
export async function GET() {
  try {
    return NextResponse.json({
      timers: getActiveTimers(),
      done: getRecentDone(8),
      stations: listStations(true),
      serverNow: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cooktimer] timers error:', msg);
    return NextResponse.json({ timers: [], done: [], stations: [], serverNow: Date.now(), error: msg }, { status: 500 });
  }
}

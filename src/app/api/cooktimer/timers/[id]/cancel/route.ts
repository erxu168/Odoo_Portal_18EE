import { NextRequest, NextResponse } from 'next/server';
import { cancelTimer } from '@/lib/cooktimer-db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cooktimer/timers/[id]/cancel
 * Abandon a timer. Its covered lines re-enter the TO COOK queue (they hold no
 * kds_line_ready row). Idempotent: cancelling a terminal timer is a no-op.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    const timer = cancelTimer(id);
    if (!timer) return NextResponse.json({ error: 'Timer not found' }, { status: 404 });
    return NextResponse.json({ timer });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cooktimer] cancel error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

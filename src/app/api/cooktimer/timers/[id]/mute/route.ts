import { NextRequest, NextResponse } from 'next/server';
import { setTimerMute } from '@/lib/cooktimer-db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cooktimer/timers/[id]/mute  body { expected_step, muted }
 * Silence (or un-silence) THIS timer's audio only. Explicit value, not a toggle,
 * and guarded by expected_step so a late mute of step N can't swallow the alarm
 * of step N+1 (mute is reset on every advance — spec decision 8).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const body = await req.json().catch(() => ({}));
    const expectedStep = Number(body.expected_step);
    const muted = Boolean(body.muted);
    if (!Number.isFinite(id) || !Number.isFinite(expectedStep)) {
      return NextResponse.json({ error: 'id and expected_step required' }, { status: 400 });
    }
    const timer = setTimerMute(id, expectedStep, muted);
    if (!timer) return NextResponse.json({ error: 'Timer not found' }, { status: 404 });
    return NextResponse.json({ timer });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cooktimer] mute error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { advanceTimer } from '@/lib/cooktimer-db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cooktimer/timers/[id]/advance  body { expected_step, mode? }
 * Acknowledge the current alarm and start the next step (or finish if it was the
 * last). `expected_step` is a compare-and-swap guard: a duplicate/stale tap whose
 * step already moved is a safe no-op. `mode` ('ack' | 'skip') is informational —
 * both advance identically (the two-tap SKIP confirm is a client concern).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const body = await req.json().catch(() => ({}));
    const expectedStep = Number(body.expected_step);
    if (!Number.isFinite(id) || !Number.isFinite(expectedStep)) {
      return NextResponse.json({ error: 'id and expected_step required' }, { status: 400 });
    }
    const timer = advanceTimer(id, expectedStep);
    if (!timer) return NextResponse.json({ error: 'Timer not found' }, { status: 404 });
    return NextResponse.json({ timer });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cooktimer] advance error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

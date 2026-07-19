import { NextRequest, NextResponse } from 'next/server';
import { finishTimer } from '@/lib/cooktimer-db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cooktimer/timers/[id]/finish  body { expected_step? }
 * Complete cooking: write a kds_line_ready row for every covered line (the main
 * KDS reads these to show a ✓ per line) and mark the timer finished. Atomic and
 * idempotent — a duplicate finish just returns the finished timer.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const expectedStep = Number.isFinite(Number(body.expected_step)) ? Number(body.expected_step) : undefined;
    const timer = finishTimer(id, expectedStep);
    if (!timer) return NextResponse.json({ error: 'Timer not found' }, { status: 404 });
    return NextResponse.json({ timer });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cooktimer] finish error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

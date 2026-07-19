import { NextRequest, NextResponse } from 'next/server';
import { getKdsSettings } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';
import { createTimer } from '@/lib/cooktimer-db';
import { loadEligibleLines } from '@/lib/cooktimer-queue';
import type { CoveredLine } from '@/types/cooktimer';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cooktimer/start  body { line_ids: number[] }
 * Start one timer over 1..n POS lines of the SAME product/profile. Line ids are
 * re-validated against the CURRENT feed (a line already started, gone, or
 * without a profile is rejected), and the claim is atomic (createTimer) so two
 * tablets can't double-start the same lines. Only lines waiting NOW are batched;
 * a line that arrives mid-cook forms the next batch (spec decision 4).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const lineIds: number[] = Array.isArray(body.line_ids)
      ? Array.from(new Set(
          (body.line_ids as unknown[]).map(n => Number(n)).filter((n): n is number => Number.isFinite(n) && n > 0)
        )).slice(0, 100) // dedupe + cap: one batch is never this large
      : [];
    if (lineIds.length === 0) {
      return NextResponse.json({ error: 'line_ids required' }, { status: 400 });
    }

    const configId = getKdsSettings(KDS_LOCATION_ID).posConfigId;
    if (!configId) return NextResponse.json({ error: 'No POS config ID set' }, { status: 400 });

    const eligible = await loadEligibleLines(configId);
    const selected = lineIds.map(id => eligible.get(id)).filter((l): l is NonNullable<typeof l> => !!l);

    if (selected.length === 0) {
      // Every requested line was already started/served or is no longer in the feed.
      return NextResponse.json({ error: 'Those items are no longer waiting' }, { status: 409 });
    }

    const profileId = selected[0].profileId;
    if (selected.some(l => l.profileId !== profileId)) {
      return NextResponse.json({ error: 'All lines in a timer must be the same product' }, { status: 400 });
    }

    const lines: CoveredLine[] = selected.map(l => ({
      lineId: l.lineId, orderId: l.orderId, ref: l.ref, qty: l.qty, arrivedMs: l.arrivedMs,
    }));
    const timer = createTimer(profileId, selected[0].stationId, lines);
    if (!timer) {
      return NextResponse.json({ error: 'Those items were just started on another tablet' }, { status: 409 });
    }
    return NextResponse.json({ timer });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cooktimer] start error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

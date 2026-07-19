import { NextRequest, NextResponse } from 'next/server';
import { getKdsSettings } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';
import { listStations } from '@/lib/cooktimer-db';
import { loadEligibleLines, buildQueueGroups, parseStationFilter } from '@/lib/cooktimer-queue';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cooktimer/queue?stations=1,2
 * TO COOK groups for the given stations (empty = all). Reuses the KDS POS feed;
 * the Cooking Timer shares the KDS pos.config. Also returns the active station
 * list so the staff tablet's settings picker needs no manager-only endpoint.
 */
export async function GET(req: NextRequest) {
  try {
    const stations = listStations(true);
    const configId = getKdsSettings(KDS_LOCATION_ID).posConfigId;
    if (!configId) {
      return NextResponse.json({ queue: [], stations, error: 'No POS config ID set (set it in the KDS settings)' });
    }
    // Absent `stations` param = all stations; present (even empty) = only those
    // ids (so a tablet with every station toggled off shows nothing, not all).
    const hasParam = req.nextUrl.searchParams.has('stations');
    const stationFilter = hasParam ? parseStationFilter(req.nextUrl.searchParams.get('stations')) : null;
    const eligible = await loadEligibleLines(configId);
    const queue = buildQueueGroups(Array.from(eligible.values()), stationFilter);
    return NextResponse.json({ queue, stations });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cooktimer] queue error:', msg);
    return NextResponse.json({ queue: [], stations: [], error: msg }, { status: 500 });
  }
}

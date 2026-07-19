/**
 * Cooking Timer queue builder: turns the shared POS feed into TO COOK groups.
 *
 * Reuses the KDS feed (fetchFiredOrders) — one poller — and keeps only lines
 * whose product has an active cook profile and that aren't already claimed by a
 * running/finished timer. Used by both /queue (to display groups) and /start (to
 * resolve the tapped line ids authoritatively).
 */
import { fetchFiredOrders, type FiredOrder } from './kds-order-feed';
import { getActiveProfilesByProduct, getClaimedLineIds } from './cooktimer-db';
import type { QueueGroup } from '@/types/cooktimer';

export interface EligibleLine {
  lineId: number;
  orderId: number;
  ref: string;
  qty: number;
  arrivedMs: number;
  profileId: number;
  profileName: string;
  stationId: number;
  stationName: string;
  stepLabels: string[];
}

function orderRef(o: FiredOrder): string {
  const tableName = Array.isArray(o.table_id) ? String(o.table_id[1]) : '';
  if (tableName) return tableName;
  const tracking = o.tracking_number ? String(o.tracking_number) : (o.name?.split('/').pop() || String(o.id));
  return `#${tracking}`;
}

/** Currently-eligible cook lines keyed by pos line id. */
export async function loadEligibleLines(configId: number): Promise<Map<number, EligibleLine>> {
  const { firedOrders, linesByOrder } = await fetchFiredOrders(configId, [
    'id', 'order_id', 'product_id', 'full_product_name', 'qty',
  ]);
  const profByProduct = getActiveProfilesByProduct();
  const claimed = getClaimedLineIds();
  const out = new Map<number, EligibleLine>();

  for (const o of firedOrders) {
    const ref = orderRef(o);
    const arrivedMs = new Date(String(o.date_order).replace(' ', 'T') + 'Z').getTime();
    for (const line of linesByOrder[o.id] || []) {
      const rawPid = line.product_id;
      const pid = Array.isArray(rawPid) ? (rawPid[0] as number) : (rawPid as number);
      const prof = profByProduct.get(pid);
      if (!prof) continue;
      const lineId = line.id as number;
      if (claimed.has(lineId)) continue;
      out.set(lineId, {
        lineId, orderId: o.id, ref, qty: (line.qty as number) || 1, arrivedMs,
        profileId: prof.id, profileName: prof.name,
        stationId: prof.stationId, stationName: prof.stationName,
        stepLabels: prof.steps.map(s => s.label),
      });
    }
  }
  return out;
}

/** Group eligible lines by profile into TO COOK cards.
 *  stationFilter: null = all stations; [] = none; [ids] = only those. */
export function buildQueueGroups(lines: EligibleLine[], stationFilter: number[] | null): QueueGroup[] {
  const byProfile = new Map<number, EligibleLine[]>();
  for (const l of lines) {
    if (stationFilter !== null && !stationFilter.includes(l.stationId)) continue;
    (byProfile.get(l.profileId) || byProfile.set(l.profileId, []).get(l.profileId)!).push(l);
  }
  const groups: QueueGroup[] = [];
  for (const items of Array.from(byProfile.values())) {
    items.sort((a, b) => a.arrivedMs - b.arrivedMs); // oldest first
    const first = items[0];
    groups.push({
      profileId: first.profileId,
      profileName: first.profileName,
      stationId: first.stationId,
      stationName: first.stationName,
      stepLabels: first.stepLabels,
      count: items.length,
      oldestArrivedMs: first.arrivedMs,
      lines: items.map(l => ({ lineId: l.lineId, orderId: l.orderId, ref: l.ref, qty: l.qty, arrivedMs: l.arrivedMs })),
    });
  }
  // Oldest group first.
  groups.sort((a, b) => a.oldestArrivedMs - b.oldestArrivedMs);
  return groups;
}

/** Parse a ?stations=1,2 query into a number[] (empty = all stations). */
export function parseStationFilter(raw: string | null): number[] {
  if (!raw) return [];
  return raw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
}

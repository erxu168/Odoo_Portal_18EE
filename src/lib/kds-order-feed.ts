/**
 * Shared read-only POS order feed for the KDS and the Cooking Timer.
 *
 * Both surfaces need the SAME fired-order set — hybrid fire trigger (paid, or a
 * draft the waiter fired via the Order button), 05:00 Europe/Berlin service-day
 * floor, refund-line exclusion. This is the single Odoo poller; the Cooking Timer
 * queue reuses it (filtering by products that have a cook profile) rather than
 * building a second poller or HTTP-fetching /api/kds/orders internally.
 *
 * NEVER writes to Odoo.
 */
import { getOdoo } from './odoo';

/** Start of the current service day (05:00 Berlin) as a UTC Odoo datetime string. */
export function serviceDayStartUtc(): string {
  const berlinNow = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' });
  let dateStr = berlinNow.slice(0, 10);
  const hour = Number(berlinNow.slice(11, 13));
  if (hour < 5) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    dateStr = d.toISOString().slice(0, 10);
  }
  // Resolve the Berlin UTC offset (CET +01:00 / CEST +02:00) for that date.
  for (const off of ['+02:00', '+01:00']) {
    const d = new Date(`${dateStr}T05:00:00${off}`);
    const back = d.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' });
    if (back.startsWith(`${dateStr} 05:00`)) {
      return d.toISOString().slice(0, 19).replace('T', ' ');
    }
  }
  return `${dateStr} 03:00:00`;
}

/** True when the waiter fired this order to the kitchen via the Order button. */
export function hasFiredLines(raw: unknown): boolean {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(
      parsed && typeof parsed === 'object' &&
      parsed.lines && Object.keys(parsed.lines).length > 0
    );
  } catch {
    return false;
  }
}

export interface FiredOrder {
  id: number;
  name: string;
  state: string;
  tracking_number: unknown;
  date_order: string;
  takeaway: boolean;
  table_id: unknown;
  general_note: unknown;
  last_order_preparation_change: unknown;
}

export interface FiredFeed {
  firedOrders: FiredOrder[];
  linesByOrder: Record<number, Record<string, unknown>[]>;
}

// A superset of the line fields BOTH callers need — the KDS its display fields,
// the Cooking Timer additionally product_id. Fetching one shape lets a single
// cached fetch serve every caller.
const LINE_FIELDS = ['id', 'order_id', 'product_id', 'full_product_name', 'qty', 'note', 'customer_note'];

// Short-lived per-config cache + single-flight. The KDS orders feed, the Cooking
// Timer queue, and every cook tablet share ONE Odoo fetch per config within the
// TTL instead of each polling Odoo independently. This is what keeps "one Odoo
// poller" true even though several routes read the feed.
const FEED_TTL_MS = 2500;
const FEED_CACHE_CAP = 32; // bound memory: a handful of real configs; evict oldest beyond this
const feedCache = new Map<number, { at: number; data: FiredFeed }>();
const inFlight = new Map<number, Promise<FiredFeed>>();

async function fetchFromOdoo(configId: number): Promise<FiredFeed> {
  const odoo = getOdoo();
  const rawOrders = await odoo.searchRead(
    'pos.order',
    [
      ['config_id', '=', configId],
      ['date_order', '>=', serviceDayStartUtc()],
      ['state', 'in', ['draft', 'paid']],
    ],
    [
      'id', 'name', 'state', 'tracking_number', 'date_order', 'takeaway',
      'table_id', 'general_note', 'last_order_preparation_change',
    ],
    { order: 'date_order ASC', limit: 80 },
  );

  const firedOrders = (rawOrders as FiredOrder[]).filter(o =>
    o.state === 'paid' || hasFiredLines(o.last_order_preparation_change)
  );

  const linesByOrder: Record<number, Record<string, unknown>[]> = {};
  if (firedOrders.length === 0) return { firedOrders, linesByOrder };

  const orderIds = firedOrders.map(o => o.id);
  const rawLines = await odoo.searchRead(
    'pos.order.line',
    [
      ['order_id', 'in', orderIds],
      ['qty', '>', 0],                       // exclude refund lines
      ['product_id.type', '!=', 'service'],  // exclude tips / fees
    ],
    LINE_FIELDS,
    { limit: 800 },
  );

  for (const line of rawLines as Record<string, unknown>[]) {
    const rawOid = line.order_id;
    const oid = Array.isArray(rawOid) ? (rawOid[0] as number) : (rawOid as number);
    if (!linesByOrder[oid]) linesByOrder[oid] = [];
    linesByOrder[oid].push(line);
  }
  return { firedOrders, linesByOrder };
}

/**
 * Fetch fired orders + their food lines for a POS config. Read-only, cached, and
 * single-flighted so concurrent callers (KDS + Cooking Timer + N tablets) share
 * one Odoo round-trip per config within FEED_TTL_MS. Returns fired orders
 * (already filtered by the hybrid trigger) and their lines grouped by order id.
 */
export async function fetchFiredOrders(configId: number): Promise<FiredFeed> {
  const cached = feedCache.get(configId);
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.data;

  const existing = inFlight.get(configId);
  if (existing) return existing;

  const p = fetchFromOdoo(configId)
    .then(data => {
      feedCache.set(configId, { at: Date.now(), data });
      // Bound the map so an arbitrary stream of configIds can't grow memory
      // without limit (the /api/kds/orders configId is caller-supplied).
      while (feedCache.size > FEED_CACHE_CAP) {
        const oldest = feedCache.keys().next().value;
        if (oldest === undefined) break;
        feedCache.delete(oldest);
      }
      return data;
    })
    .finally(() => { inFlight.delete(configId); });
  inFlight.set(configId, p);
  return p;
}

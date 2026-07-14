/**
 * What a Jerk — Sales Dashboard data layer
 *
 * Focused, WAJ-only sales analytics for the manager dashboard at /sales.
 * Reads POS data from Odoo (pos.order / pos.order.line / pos.payment) scoped to
 * the What a Jerk company, and kitchen prep-time from the portal KDS store.
 *
 * Design notes:
 *  - WAJ company/config are resolved BY NAME at runtime (cached), because the id
 *    differs by environment (staging co6, production co5). Never hardcode.
 *  - Date/range math lives in ./waj-sales-time (pure, unit-tested, DST-correct).
 *  - Own paginated fetchers: the shared OdooClient.searchRead caps at 200 rows
 *    when limit<=0, which would silently truncate month ranges.
 */

import { getOdoo } from './odoo';
import { getPrepHistory, getRecentDoneStages } from './kds-db';
import {
  DOW, berlinParts, berlinDayOf, utcStr, computeBounds,
  weekdayLabel, dayOfMonthLabel, type Range, type Bounds,
} from './waj-sales-time';

export type { Range } from './waj-sales-time';

const SOLD = ['paid', 'done', 'invoiced'];
const PREP_TARGET_SEC = 600;          // 10 min
const PREP_MAX_SEC = 3 * 3600;        // ignore prep times over 3h (abandoned/void)

export interface SalesPayload {
  range: Range;
  sub: string;
  cmp: string;
  trendUnit: string;
  trend: [string, number, number][];      // [label, sales, orders]
  prevSales: number;
  prevOrders: number;
  products: [string, number, number][];    // [name, qty, revenue]
  hours: [string, number][];               // [hourLabel, orders]
  hoursHint: string;
  dow: [string, number][] | null;          // [dayLabel, avgSales]
  salesTotal: number;
  ordersTotal: number;
  cashPct: number;
  cashAmt: number;
  cardAmt: number;
  dineInPct: number;
  dineInOrders: number;
  takeawayOrders: number;
  avgItems: number;
  items: [string, number][];               // [bucketLabel, pct]
  prepAvg: number;                         // seconds
  prepFast: number;
  prepSlow: number;
  prepUnder: number;                       // % under target
  coverage: number;                        // % of orders with a recorded prep time
  prepDow: [string, number][] | null;      // [dayLabel, minutes]
  kitchenHasData: boolean;
  meta: { companyId: number; configId: number | null; company: string };
}

// ── WAJ identity resolver (cached by name) ───────────────
interface WajId { companyId: number; configId: number | null; company: string }
let _waj: { at: number; val: WajId } | null = null;

export async function resolveWaj(): Promise<WajId> {
  if (_waj && Date.now() - _waj.at < 60 * 60 * 1000) return _waj.val;
  const odoo = getOdoo();
  const cos = await odoo.searchRead(
    'res.company',
    [['name', 'ilike', 'what a jerk']],
    ['id', 'name', 'active'],
    { limit: 10, context: { active_test: false } },
  );
  if (!cos.length) throw new Error('What a Jerk company not found in Odoo');
  // Prefer an active company (avoids picking an archived "WAJ ALT"/test clone).
  const activeCos = (cos as any[]).filter(c => c.active);
  const co = (activeCos.length ? activeCos : (cos as any[])).sort((a, b) => a.id - b.id)[0];
  const cfgs = await odoo.searchRead(
    'pos.config',
    [['company_id', '=', co.id]],
    ['id', 'name', 'active'],
    { limit: 10, context: { active_test: false } },
  );
  const cfg = (cfgs as any[]).find(c => c.active) || (cfgs as any[])[0] || null;
  const val: WajId = { companyId: co.id, configId: cfg ? cfg.id : null, company: co.name };
  _waj = { at: Date.now(), val };
  return val;
}

// ── paginated fetch (avoids searchRead's limit<=0 -> 200 cap) ──
async function fetchAll(model: string, domain: any[], fields: string[], order = ''): Promise<any[]> {
  const odoo = getOdoo();
  const pageSize = 1000;
  let offset = 0;
  const out: any[] = [];
  for (;;) {
    const page = await odoo.searchRead(model, domain, fields, { limit: pageSize, offset, order });
    out.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
    if (offset > 200000) break; // hard safety
  }
  return out;
}

// ── main compute ────────────────────────────────────────
export async function computeSales(range: Range, nowMs: number): Promise<SalesPayload> {
  const waj = await resolveWaj();
  const b = computeBounds(range, nowMs);
  const cStart = utcStr(b.curStartMs), cEnd = utcStr(b.curEndMs);
  const pStart = utcStr(b.prevStartMs), pEnd = utcStr(b.prevEndMs);

  const [orders, prevOrders, lines, payments] = await Promise.all([
    fetchAll('pos.order',
      [['company_id', '=', waj.companyId], ['date_order', '>=', cStart], ['date_order', '<', cEnd], ['state', 'in', SOLD]],
      ['id', 'date_order', 'amount_total', 'takeaway'], 'date_order asc'),
    fetchAll('pos.order',
      [['company_id', '=', waj.companyId], ['date_order', '>=', pStart], ['date_order', '<', pEnd], ['state', 'in', SOLD]],
      ['id', 'amount_total']),
    fetchAll('pos.order.line',
      [['order_id.company_id', '=', waj.companyId], ['order_id.date_order', '>=', cStart], ['order_id.date_order', '<', cEnd], ['order_id.state', 'in', SOLD]],
      ['order_id', 'product_id', 'qty', 'price_subtotal_incl']),
    fetchAll('pos.payment',
      [['company_id', '=', waj.companyId], ['payment_date', '>=', cStart], ['payment_date', '<', cEnd]],
      ['payment_method_id', 'amount']),
  ]);

  // ---- trend ----
  const trend = buildTrend(orders, b);
  const prevSales = (prevOrders as any[]).reduce((a, o) => a + o.amount_total, 0);

  // ---- products + items-per-order ----
  const prodMap = new Map<number, { name: string; qty: number; rev: number }>();
  const orderItems = new Map<number, number>();
  for (const l of lines as any[]) {
    const oid = l.order_id ? l.order_id[0] : 0;
    const pname = l.product_id ? String(l.product_id[1]) : '';
    const pid = l.product_id ? l.product_id[0] : 0;
    if (pname.toLowerCase().includes('tip')) continue;
    const e = prodMap.get(pid) || { name: pname, qty: 0, rev: 0 };
    e.qty += l.qty; e.rev += l.price_subtotal_incl;
    prodMap.set(pid, e);
    orderItems.set(oid, (orderItems.get(oid) || 0) + Math.max(0, l.qty));
  }
  // Keep the union of the revenue and quantity leaders so the client can rank by
  // either without a low-price, high-volume item being dropped by a revenue cut.
  const prodEntries = Array.from(prodMap.entries());
  const keep = new Set<number>([
    ...[...prodEntries].sort((a, c) => c[1].rev - a[1].rev).slice(0, 12).map(e => e[0]),
    ...[...prodEntries].sort((a, c) => c[1].qty - a[1].qty).slice(0, 12).map(e => e[0]),
  ]);
  const products: [string, number, number][] = prodEntries
    .filter(e => keep.has(e[0]))
    .sort((a, c) => c[1].rev - a[1].rev)
    .map(e => [e[1].name, Math.round(e[1].qty), Math.round(e[1].rev)]);

  // ---- busy hours ----
  const activeDays = new Set((orders as any[]).map(o => berlinParts(o.date_order).day)).size || 1;
  const hourMap = new Map<number, number>();
  for (const o of orders as any[]) {
    const h = berlinParts(o.date_order).hour;
    hourMap.set(h, (hourMap.get(h) || 0) + 1);
  }
  const hours: [string, number][] = Array.from(hourMap.keys()).sort((a, c) => a - c).map(h => {
    const v = hourMap.get(h) || 0;
    return [String(h).padStart(2, '0'), b.gran === 'hour' ? v : Math.round(v / activeDays)];
  });
  const hoursHint = b.gran === 'hour' ? 'orders' : 'avg / hour';

  // ---- day of week (week/month) ----
  let dow: [string, number][] | null = null;
  if (b.gran === 'day') {
    const bySales = new Map<number, number>();
    const dates = new Map<number, Set<string>>();
    for (const o of orders as any[]) {
      const p = berlinParts(o.date_order);
      bySales.set(p.dow, (bySales.get(p.dow) || 0) + o.amount_total);
      if (!dates.has(p.dow)) dates.set(p.dow, new Set());
      dates.get(p.dow)!.add(p.day);
    }
    dow = [];
    for (let i = 0; i < 7; i++) {
      if (!bySales.has(i)) continue;
      const n = dates.get(i)!.size || 1;
      dow.push([DOW[i], Math.round((bySales.get(i) || 0) / n)]);
    }
    if (!dow.length) dow = null;
  }

  // ---- totals (exact, so the client never reconstructs from rounded %) ----
  const salesTotal = Math.round((orders as any[]).reduce((a, o) => a + o.amount_total, 0));
  const ordersTotal = orders.length;

  // ---- payments (WAJ has only Cash + Card methods; non-cash => card) ----
  let cash = 0, card = 0;
  for (const p of payments as any[]) {
    const name = p.payment_method_id ? String(p.payment_method_id[1]).toLowerCase() : '';
    if (name.includes('cash') || name.includes('bar')) cash += p.amount;
    else card += p.amount;
  }
  const payTotal = cash + card;
  const cashPct = payTotal ? Math.round((cash / payTotal) * 100) : 0;

  // ---- dine-in vs take-away ----
  const dineInOrders = (orders as any[]).filter(o => !o.takeaway).length;
  const takeawayOrders = ordersTotal - dineInOrders;
  const dineInPct = ordersTotal ? Math.round((dineInOrders / ordersTotal) * 100) : 0;

  // ---- items per order (consistent denominator; skip 0-item/refund orders) ----
  const buckets: Record<string, number> = { '1 item': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  let counted = 0, itemSum = 0;
  orderItems.forEach(qty => {
    const q = Math.floor(qty);
    if (q < 1) return;
    const key = q >= 5 ? '5+' : (q === 1 ? '1 item' : String(q));
    buckets[key]++; counted++; itemSum += q;
  });
  const avgItems = counted ? Math.round((itemSum / counted) * 10) / 10 : 0;
  const items: [string, number][] = Object.entries(buckets).map(([k, v]) => [k, counted ? Math.round((v / counted) * 100) : 0]);

  // ---- kitchen ----
  const kitchen = await computeKitchen(waj.companyId, b);

  return {
    range, sub: b.sub, cmp: b.cmp,
    trendUnit: b.gran === 'hour' ? 'By hour' : 'By day',
    trend, prevSales: Math.round(prevSales), prevOrders: (prevOrders as any[]).length,
    products, hours, hoursHint, dow,
    salesTotal, ordersTotal,
    cashPct, cashAmt: Math.round(cash), cardAmt: Math.round(card),
    dineInPct, dineInOrders, takeawayOrders,
    avgItems, items,
    ...kitchen,
    meta: { companyId: waj.companyId, configId: waj.configId, company: waj.company },
  };
}

function buildTrend(orders: any[], b: Bounds): [string, number, number][] {
  if (b.gran === 'hour') {
    const m = new Map<number, { s: number; o: number }>();
    for (const o of orders) {
      const h = berlinParts(o.date_order).hour;
      const e = m.get(h) || { s: 0, o: 0 };
      e.s += o.amount_total; e.o += 1; m.set(h, e);
    }
    return Array.from(m.keys()).sort((a, c) => a - c)
      .map(h => [String(h).padStart(2, '0'), Math.round(m.get(h)!.s), m.get(h)!.o] as [string, number, number]);
  }
  const m = new Map<string, { s: number; o: number }>();
  for (const o of orders) {
    const day = berlinParts(o.date_order).day;
    const e = m.get(day) || { s: 0, o: 0 };
    e.s += o.amount_total; e.o += 1; m.set(day, e);
  }
  return Array.from(m.keys()).sort().map(day => {
    const label = b.range === 'week' ? weekdayLabel(day) : dayOfMonthLabel(day);
    return [label, Math.round(m.get(day)!.s), m.get(day)!.o] as [string, number, number];
  });
}

// ── kitchen prep time (KDS store + Odoo order start) ─────
async function computeKitchen(companyId: number, b: Bounds): Promise<{
  prepAvg: number; prepFast: number; prepSlow: number; prepUnder: number;
  coverage: number; prepDow: [string, number][] | null; kitchenHasData: boolean;
}> {
  const startDay = berlinDayOf(b.curStartMs);
  const endDay = berlinDayOf(b.curEndMs);

  // 1) permanent archive rows for the period
  const hist = getPrepHistory(companyId, startDay, endDay);
  const seen = new Set<number>(hist.map(r => r.order_id));
  const samples: { ms: number; dow: number }[] = [];
  for (const r of hist) {
    if (r.prep_ms > 0 && r.prep_ms < PREP_MAX_SEC * 1000) {
      samples.push({ ms: r.prep_ms, dow: berlinParts(utcStr(r.done_at)).dow });
    }
  }

  // 2) supplement from the live 3-day KDS table for orders not yet archived
  const recent = getRecentDoneStages(b.curStartMs, b.curEndMs);
  const need = recent.filter(r => !seen.has(r.order_id));
  if (need.length) {
    const rows = await fetchAll('pos.order',
      [['id', 'in', need.map(r => r.order_id)], ['company_id', '=', companyId]],
      ['id', 'date_order']);
    const startById = new Map<number, number>();
    for (const o of rows as any[]) startById.set(o.id, Date.parse(o.date_order.replace(' ', 'T') + 'Z'));
    for (const r of need) {
      const st = startById.get(r.order_id);
      if (st == null) continue; // not a WAJ order
      const ms = r.done_at - st;
      if (ms > 0 && ms < PREP_MAX_SEC * 1000) samples.push({ ms, dow: berlinParts(utcStr(r.done_at)).dow });
    }
  }

  if (!samples.length) {
    return { prepAvg: 0, prepFast: 0, prepSlow: 0, prepUnder: 0, coverage: 0, prepDow: null, kitchenHasData: false };
  }
  const msArr = samples.map(s => s.ms);
  const avg = msArr.reduce((a, c) => a + c, 0) / msArr.length / 1000;
  const under = Math.round(msArr.filter(m => m <= PREP_TARGET_SEC * 1000).length / msArr.length * 100);

  // coverage vs total sold orders in the period
  const totalOrders = await fetchAll('pos.order',
    [['company_id', '=', companyId], ['date_order', '>=', utcStr(b.curStartMs)], ['date_order', '<', utcStr(b.curEndMs)], ['state', 'in', SOLD]],
    ['id']);
  const coverage = totalOrders.length ? Math.min(100, Math.round(samples.length / totalOrders.length * 100)) : 0;

  let prepDow: [string, number][] | null = null;
  if (b.gran === 'day') {
    const g = new Map<number, number[]>();
    for (const s of samples) { if (!g.has(s.dow)) g.set(s.dow, []); g.get(s.dow)!.push(s.ms); }
    prepDow = [];
    for (let i = 0; i < 7; i++) {
      const arr = g.get(i);
      if (!arr || !arr.length) continue;
      prepDow.push([DOW[i], Math.round(arr.reduce((a, c) => a + c, 0) / arr.length / 60000 * 10) / 10]);
    }
    if (!prepDow.length) prepDow = null;
  }

  return {
    prepAvg: Math.round(avg),
    prepFast: Math.round(Math.min(...msArr) / 1000),
    prepSlow: Math.round(Math.max(...msArr) / 1000),
    prepUnder: under, coverage, prepDow, kitchenHasData: true,
  };
}

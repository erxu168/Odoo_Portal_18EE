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
  DOW, MON, berlinParts, berlinDayOf, utcStr, computeBounds,
  weekdayLabel, dayOfMonthLabel, classifyCategory, projectMonth, daysInMonthOf,
  type Range, type Bounds,
} from './waj-sales-time';

export type { Range } from './waj-sales-time';

const SOLD = ['paid', 'done', 'invoiced'];
// Food-cost % per menu group — WAJ owner's figures (2026-07-15): 30% food, 35% drinks.
// Sides/sauces treated as food. Adjust here if the real costs change.
const COST_PCT: Record<string, number> = { food: 30, drink: 35, side: 30, sauce: 30 };
const PREP_TARGET_SEC = 600;          // 10 min
const PREP_MAX_SEC = 3 * 3600;        // ignore prep times over 3h (abandoned/void)

export interface SalesPayload {
  range: Range;
  sub: string;
  prevLabel: string;                       // '' => no previous-period delta
  yoyLabel: string;                        // '' => no year-on-year delta
  trendUnit: string;
  trend: [string, number, number][];      // [label, sales, orders]
  trendPrev: ([number, number] | null)[]; // aligned to trend: [prevSales, prevOrders] | null
  trendPrevLabel: string;
  prevSales: number;
  prevOrders: number;
  yoySales: number;
  yoyOrders: number;
  products: [string, number, number][];    // [name, qty, revenue]
  categories: [string, number, number][];  // [category, qty, revenue]
  foodRev: number;
  drinkRev: number;
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
  // ── additional KPIs ──
  projectedMonthEnd: number | null;
  drinkAttachPct: number;
  sideAttachPct: number;
  slowSellers: [string, number, number][];        // [name, qty, revenue]
  profitByCat: [string, number, number][];         // [category, estProfit, marginPct]
  estGrossProfit: number;
  refunds: { count: number; amount: number };
  voids: number;
  discounts: { amount: number; count: number };
  till: { name: string; date: string; diff: number }[];
  tillNet: number;
  staff: [string, number, number][];               // [name, orders, sales]
  tips: { total: number; ratePct: number; avgWhenTipped: number };
  heatmap: { hours: number[]; rows: [string, number[]][] } | null;
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

/** Sales € + order count for a [startMs, endMs) window (empty if not set). */
async function periodTotals(companyId: number, startMs: number, endMs: number): Promise<{ sales: number; orders: number }> {
  if (!startMs || endMs <= startMs) return { sales: 0, orders: 0 };
  const rows = await fetchAll('pos.order',
    [['company_id', '=', companyId], ['date_order', '>=', utcStr(startMs)], ['date_order', '<', utcStr(endMs)], ['state', 'in', SOLD]],
    ['amount_total']);
  return { sales: Math.round((rows as any[]).reduce((a, o) => a + o.amount_total, 0)), orders: rows.length };
}

// ── main compute ────────────────────────────────────────
export async function computeSales(range: Range, anchorDay: string, nowMs: number): Promise<SalesPayload> {
  const waj = await resolveWaj();
  const b = computeBounds(range, anchorDay, nowMs);
  const cStart = utcStr(b.curStartMs), cEnd = utcStr(b.curEndMs);

  // Ghost line = the comparison period: previous period (week/month/day) or, for
  // YTD/Year, last year (they have no separate "previous period").
  const ghostStartMs = b.prevLabel ? b.prevStartMs : b.yoyStartMs;
  const ghostEndMs = b.prevLabel ? b.prevEndMs : b.yoyEndMs;

  const [orders, lines, payments, sessions, ghostOrders, otherTotals] = await Promise.all([
    fetchAll('pos.order',
      [['company_id', '=', waj.companyId], ['date_order', '>=', cStart], ['date_order', '<', cEnd], ['state', 'in', SOLD]],
      ['id', 'date_order', 'amount_total', 'takeaway', 'employee_id', 'tip_amount', 'has_deleted_line'], 'date_order asc'),
    fetchAll('pos.order.line',
      [['order_id.company_id', '=', waj.companyId], ['order_id.date_order', '>=', cStart], ['order_id.date_order', '<', cEnd], ['order_id.state', 'in', SOLD]],
      ['order_id', 'product_id', 'qty', 'price_subtotal', 'price_subtotal_incl', 'discount', 'price_unit']),
    fetchAll('pos.payment',
      [['company_id', '=', waj.companyId], ['payment_date', '>=', cStart], ['payment_date', '<', cEnd]],
      ['payment_method_id', 'amount']),
    waj.configId
      ? fetchAll('pos.session',
        [['company_id', '=', waj.companyId], ['config_id', '=', waj.configId], ['state', '=', 'closed'], ['stop_at', '>=', cStart], ['stop_at', '<', cEnd]],
        ['name', 'stop_at', 'cash_register_difference'], 'stop_at asc')
      : Promise.resolve([]),
    ghostStartMs
      ? fetchAll('pos.order',
        [['company_id', '=', waj.companyId], ['date_order', '>=', utcStr(ghostStartMs)], ['date_order', '<', utcStr(ghostEndMs)], ['state', 'in', SOLD]],
        ['date_order', 'amount_total'])
      : Promise.resolve([]),
    // Only the comparison window NOT covered by ghostOrders needs its own totals:
    // for day/week/month that's YoY; for YTD/Year there is no separate previous period.
    b.prevLabel ? periodTotals(waj.companyId, b.yoyStartMs, b.yoyEndMs) : Promise.resolve({ sales: 0, orders: 0 }),
  ]);
  const ghostTotals = { sales: Math.round((ghostOrders as any[]).reduce((a, o) => a + o.amount_total, 0)), orders: (ghostOrders as any[]).length };
  const prev = b.prevLabel ? ghostTotals : { sales: 0, orders: 0 };
  const yoy = b.prevLabel ? otherTotals : ghostTotals;

  // ---- trend (current series + aligned previous-period "ghost") ----
  const trendPts = buildTrend(orders, b);
  const trend: [string, number, number][] = trendPts.map(p => [p.label, p.sales, p.orders]);
  const ghostMap = new Map<number, { s: number; o: number }>();
  for (const o of ghostOrders as any[]) {
    const key = trendKeyOf(berlinParts(o.date_order), b);
    const e = ghostMap.get(key) || { s: 0, o: 0 };
    e.s += o.amount_total; e.o += 1; ghostMap.set(key, e);
  }
  const trendPrev: ([number, number] | null)[] = trendPts.map(p => {
    const g = ghostMap.get(p.key);
    return g ? [g.s, g.o] : null;
  });
  const trendPrevLabel = b.prevLabel || b.yoyLabel;

  // ---- products + items-per-order ----
  const prodMap = new Map<number, { name: string; qty: number; rev: number }>();
  const orderItems = new Map<number, number>();
  let foodRev = 0, drinkRev = 0, discountAmt = 0, discountLines = 0;
  for (const l of lines as any[]) {
    const oid = l.order_id ? l.order_id[0] : 0;
    const pname = l.product_id ? String(l.product_id[1]) : '';
    const pid = l.product_id ? l.product_id[0] : 0;
    if (pname.toLowerCase().includes('tip')) continue;
    const e = prodMap.get(pid) || { name: pname, qty: 0, rev: 0 };
    e.qty += l.qty; e.rev += l.price_subtotal_incl;
    prodMap.set(pid, e);
    orderItems.set(oid, (orderItems.get(oid) || 0) + Math.max(0, l.qty));
    // Food vs drink by German VAT: drinks 19%, food 7% (WAJ applies no dine-in bump).
    // Include refund lines (negative) so the split reconciles with net revenue.
    const sub = l.price_subtotal, incl = l.price_subtotal_incl;
    if (sub !== 0) { if ((incl / sub - 1) * 100 > 15) drinkRev += incl; else foodRev += incl; }
    const disc = l.discount || 0;
    // pre-tax discount given = list line value x discount% (handles up to 100%)
    if (disc > 0) { discountAmt += (l.price_unit || 0) * (l.qty || 0) * (disc / 100); discountLines++; }
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

  // ---- categories (group products by their POS category) ----
  // pos_categ_ids is a m2m (returns ids); a product usually has exactly one, so we
  // attribute to the first. active_test:false keeps archived products/categories.
  const odoo = getOdoo();
  const pids = Array.from(prodMap.keys()).filter(id => id > 0);
  const prodCats = pids.length
    ? await odoo.searchRead('product.product', [['id', 'in', pids]], ['pos_categ_ids'], { limit: pids.length, context: { active_test: false } })
    : [];
  const firstCatByPid = new Map<number, number | null>();
  const catIds = new Set<number>();
  for (const p of prodCats as any[]) {
    const ids: number[] = p.pos_categ_ids || [];
    const first = ids.length ? ids[0] : null;
    firstCatByPid.set(p.id, first);
    if (first) catIds.add(first);
  }
  const catNameRows = catIds.size
    ? await odoo.searchRead('pos.category', [['id', 'in', Array.from(catIds)]], ['name'], { limit: catIds.size, context: { active_test: false } })
    : [];
  const catNameById = new Map<number, string>((catNameRows as any[]).map(c => [c.id, String(c.name)]));
  const catMap = new Map<string, { qty: number; rev: number }>();
  prodMap.forEach((e, pid) => {
    const cid = firstCatByPid.get(pid);
    const cat = (cid && catNameById.get(cid)) || 'Uncategorised';
    const c = catMap.get(cat) || { qty: 0, rev: 0 };
    c.qty += e.qty; c.rev += e.rev; catMap.set(cat, c);
  });
  const categories: [string, number, number][] = Array.from(catMap.entries())
    .sort((a, c) => c[1].rev - a[1].rev)
    .slice(0, 10)
    .map(([name, v]) => [name, Math.round(v.qty), Math.round(v.rev)]);

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

  // ═══ additional KPIs ═══════════════════════════════════
  const today = berlinDayOf(nowMs);
  const groupByPid = (pid: number) => {
    const cid = firstCatByPid.get(pid);
    return classifyCategory((cid && catNameById.get(cid)) || '').group;
  };

  // Behavioral KPIs exclude refund orders (negative totals); financial KPIs keep them.
  const saleOrders = (orders as any[]).filter(o => o.amount_total >= 0);
  const saleCount = saleOrders.length;

  // drink/side attach rate (share of sale orders that include a drink / a side)
  const ordersWithDrink = new Set<number>(), ordersWithSide = new Set<number>();
  for (const l of lines as any[]) {
    const oid = l.order_id ? l.order_id[0] : 0;
    const pid = l.product_id ? l.product_id[0] : 0;
    if (!oid || !pid || (l.qty || 0) <= 0) continue;
    const g = groupByPid(pid);
    if (g === 'drink') ordersWithDrink.add(oid);
    else if (g === 'side') ordersWithSide.add(oid);
  }
  const drinkAttachPct = saleCount ? Math.round((ordersWithDrink.size / saleCount) * 100) : 0;
  const sideAttachPct = saleCount ? Math.round((ordersWithSide.size / saleCount) * 100) : 0;

  // slowest movers (fewest sold, among products with net positive sales)
  const slowSellers: [string, number, number][] = Array.from(prodMap.values())
    .filter(p => p.qty > 0)
    .sort((a, c) => a.qty - c.qty).slice(0, 6)
    .map(p => [p.name, Math.round(p.qty), Math.round(p.rev)]);

  // estimated profit by category (ROUGH: revenue x (1 - assumed food cost))
  const catProfit: [string, number, number][] = Array.from(catMap.entries()).map(([name, v]) => {
    const marginPct = 100 - (COST_PCT[classifyCategory(name).group] ?? 33);
    return [name, Math.round((v.rev * marginPct) / 100), marginPct] as [string, number, number];
  });
  const estGrossProfit = catProfit.reduce((a, c) => a + c[1], 0); // full total, not just top 10
  const profitByCat = catProfit.sort((a, c) => c[1] - a[1]).slice(0, 10);

  // refunds, voids, discounts (financial — refunds kept)
  const refundOrders = (orders as any[]).filter(o => o.amount_total < 0);
  const refunds = { count: refundOrders.length, amount: Math.round(refundOrders.reduce((a, o) => a + Math.abs(o.amount_total), 0)) };
  const voids = (orders as any[]).filter(o => o.has_deleted_line).length;
  const discounts = { amount: Math.round(discountAmt), count: discountLines };

  // till over/short per closed session (by closing date)
  const till = (sessions as any[]).map(s => ({
    name: String(s.name),
    date: s.stop_at ? berlinParts(String(s.stop_at)).day : '',
    diff: Math.round((s.cash_register_difference || 0) * 100) / 100,
  }));
  const tillNet = Math.round(till.reduce((a, t) => a + t.diff, 0) * 100) / 100;

  // sales per staff (keyed by employee id so same-named staff stay separate)
  const staffMap = new Map<number, { name: string; orders: number; sales: number }>();
  for (const o of saleOrders) {
    const id = o.employee_id ? o.employee_id[0] : -1;
    const e = staffMap.get(id) || { name: o.employee_id ? String(o.employee_id[1]) : 'Unassigned', orders: 0, sales: 0 };
    e.orders += 1; e.sales += o.amount_total; staffMap.set(id, e);
  }
  const staff: [string, number, number][] = Array.from(staffMap.values())
    .map(e => [e.name, e.orders, Math.round(e.sales)] as [string, number, number])
    .sort((a, c) => c[2] - a[2]);

  // tips (from sale orders)
  const tipTotal = saleOrders.reduce((a, o) => a + (o.tip_amount || 0), 0);
  const tippedCount = saleOrders.filter(o => (o.tip_amount || 0) > 0).length;
  const tips = {
    total: Math.round(tipTotal * 100) / 100,
    ratePct: saleCount ? Math.round((tippedCount / saleCount) * 100) : 0,
    avgWhenTipped: tippedCount ? Math.round((tipTotal / tippedCount) * 100) / 100 : 0,
  };

  // busy heatmap — AVG orders per weekday-hour (normalized by weekday count) — multi-day only
  let heatmap: { hours: number[]; rows: [string, number[]][] } | null = null;
  if (b.gran !== 'hour') {
    const hourSet = new Set<number>();
    const grid = new Map<number, Map<number, number>>();
    const dowDates = new Map<number, Set<string>>();
    for (const o of saleOrders) {
      const p = berlinParts(o.date_order);
      hourSet.add(p.hour);
      if (!grid.has(p.dow)) grid.set(p.dow, new Map());
      grid.get(p.dow)!.set(p.hour, (grid.get(p.dow)!.get(p.hour) || 0) + 1);
      if (!dowDates.has(p.dow)) dowDates.set(p.dow, new Set());
      dowDates.get(p.dow)!.add(p.day);
    }
    const hours = Array.from(hourSet).sort((a, c) => a - c);
    if (hours.length) {
      const rows: [string, number[]][] = [];
      for (let i = 0; i < 7; i++) {
        const row = grid.get(i);
        if (!row) continue;
        const n = dowDates.get(i)?.size || 1;
        rows.push([DOW[i], hours.map(h => Math.round(((row.get(h) || 0) / n) * 10) / 10)]);
      }
      heatmap = { hours, rows };
    }
  }

  // month projection (current month only, using fractional elapsed days)
  let projectedMonthEnd: number | null = null;
  if (b.range === 'month' && b.anchorDay.slice(0, 7) === today.slice(0, 7)) {
    projectedMonthEnd = projectMonth(salesTotal, (b.curEndMs - b.curStartMs) / 86400000, daysInMonthOf(today));
  }

  return {
    range, sub: b.sub, prevLabel: b.prevLabel, yoyLabel: b.yoyLabel,
    trendUnit: b.gran === 'hour' ? 'By hour' : b.gran === 'month' ? 'By month' : 'By day',
    trend, trendPrev, trendPrevLabel,
    prevSales: prev.sales, prevOrders: prev.orders,
    yoySales: yoy.sales, yoyOrders: yoy.orders,
    products, categories, foodRev: Math.round(foodRev), drinkRev: Math.round(drinkRev),
    hours, hoursHint, dow,
    salesTotal, ordersTotal,
    cashPct, cashAmt: Math.round(cash), cardAmt: Math.round(card),
    dineInPct, dineInOrders, takeawayOrders,
    avgItems, items,
    projectedMonthEnd,
    drinkAttachPct, sideAttachPct, slowSellers,
    profitByCat, estGrossProfit,
    refunds, voids, discounts,
    till, tillNet, staff, tips, heatmap,
    ...kitchen,
    meta: { companyId: waj.companyId, configId: waj.configId, company: waj.company },
  };
}

interface TrendPoint { key: number; label: string; sales: number; orders: number }

/** Position key for a bucket, so the ghost (previous period) line aligns to it:
 *  hour-of-day / day-of-month / weekday index / month-of-year. */
function trendKeyOf(p: { day: string; hour: number; dow: number }, b: Bounds): number {
  if (b.gran === 'hour') return p.hour;
  if (b.gran === 'month') return Number(p.day.slice(5, 7));
  return b.weekly ? p.dow : Number(p.day.slice(8, 10));
}

function buildTrend(orders: any[], b: Bounds): TrendPoint[] {
  if (b.gran === 'hour') {
    const m = new Map<number, { s: number; o: number }>();
    for (const o of orders) {
      const h = berlinParts(o.date_order).hour;
      const e = m.get(h) || { s: 0, o: 0 };
      e.s += o.amount_total; e.o += 1; m.set(h, e);
    }
    return Array.from(m.keys()).sort((a, c) => a - c)
      .map(h => ({ key: h, label: String(h).padStart(2, '0'), sales: m.get(h)!.s, orders: m.get(h)!.o }));
  }
  const byMonth = b.gran === 'month';
  const m = new Map<string, { s: number; o: number }>();
  if (byMonth) {
    // Prefill every month in the window so a zero-sales month shows a gap.
    let cur = berlinParts(utcStr(b.curStartMs)).day.slice(0, 7);
    const end = berlinParts(utcStr(Math.max(b.curStartMs, b.curEndMs - 1))).day.slice(0, 7);
    for (let guard = 0; guard < 400; guard++) {
      m.set(cur, { s: 0, o: 0 });
      if (cur >= end) break;
      let [yy, mm] = cur.split('-').map(Number); mm++; if (mm > 12) { mm = 1; yy++; }
      cur = `${yy}-${String(mm).padStart(2, '0')}`;
    }
  }
  for (const o of orders) {
    const day = berlinParts(o.date_order).day;
    const key = byMonth ? day.slice(0, 7) : day; // YYYY-MM or YYYY-MM-DD
    const e = m.get(key) || { s: 0, o: 0 };
    e.s += o.amount_total; e.o += 1; m.set(key, e);
  }
  return Array.from(m.keys()).sort().map(k => ({
    key: byMonth ? Number(k.slice(5, 7)) : b.weekly ? DOW.indexOf(weekdayLabel(k)) : Number(k.slice(8, 10)),
    label: byMonth ? MON[Number(k.slice(5, 7)) - 1] : b.weekly ? weekdayLabel(k) : dayOfMonthLabel(k),
    sales: m.get(k)!.s, orders: m.get(k)!.o,
  }));
}

// ── kitchen prep time (KDS store + Odoo order start) ─────
async function computeKitchen(companyId: number, b: Bounds): Promise<{
  prepAvg: number; prepFast: number; prepSlow: number; prepUnder: number;
  coverage: number; prepDow: [string, number][] | null; kitchenHasData: boolean;
}> {
  const startDay = berlinDayOf(b.curStartMs);
  const endDay = berlinDayOf(b.curEndMs - 1); // curEndMs is exclusive; use the last included instant

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
  const recent = getRecentDoneStages(b.curStartMs, b.curEndMs - 1);
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

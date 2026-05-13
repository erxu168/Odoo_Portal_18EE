/**
 * Krawings Report Builder — Computation Engine
 * 
 * Takes raw Odoo data from report-queries.ts and produces typed KPI objects.
 * All aggregation, grouping, and statistical analysis happens here.
 * 
 * Designed as pure functions where possible. Each `compute*` function maps
 * 1:1 to an API route.
 */

import type {
  KpiValue, LocationInfo,
  DashboardData, DailyBreakdownData, DailyRow,
  ComparisonData, ComparisonPeriod, DayComparison,
  RecordsData, RecordEntry,
  PnlData, PnlRatio, PnlLineItem,
  OperationsData, PaymentMethodSplit, HourlyBucket,
  CashierPerformance, OrderComposition, TablePerformance,
  TipByEmployee, TipByDayOfWeek, TipMonthlyTrend, DailyTipVolatility,
  RevPASH, SessionCashDiff,
  MenuData, ProductSales, CategoryMix, DrinkFoodRatio,
  LocationComparisonData, LocationMetric,
  OwnerReportData, AlertItem, HealthScore,
} from '@/types/reports';
import {
  fetchOrders, fetchRefunds, fetchOrderLines, fetchPayments,
  fetchSessions, fetchAccountMoveLines, fetchTables, fetchProducts,
  getActiveLocations,
  monthStart, monthEnd, weekStart, weekEnd,
} from './report-queries';

// ═══════════════════════════════════════════════════════
// FORMATTERS & HELPERS
// ═══════════════════════════════════════════════════════

const EUR = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat('de-DE');
const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const formatEur = (v: number) => EUR.format(v);
export const formatNum = (v: number) => NUM.format(v);
export const formatPct = (v: number, d = 1) => `${v.toFixed(d)}%`;

function dowName(dateStr: string): string {
  const day = new Date(dateStr).getDay();
  return DOW_NAMES[day === 0 ? 6 : day - 1];
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6;
}

function utcToBerlinDate(utcStr: string): string {
  const d = new Date(utcStr.replace(' ', 'T') + 'Z');
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString().substring(0, 10);
}

function utcToBerlinHour(utcStr: string): number {
  const d = new Date(utcStr.replace(' ', 'T') + 'Z');
  d.setUTCHours(d.getUTCHours() + 1);
  return d.getUTCHours();
}

function buildKpi(
  current: number,
  previous: number | undefined,
  formatter: (n: number) => string = formatEur,
): KpiValue {
  const kpi: KpiValue = {
    value: current,
    formatted: formatter(current),
    trend: 'flat',
  };
  if (previous !== undefined && previous !== 0) {
    kpi.previousValue = previous;
    kpi.previousFormatted = formatter(previous);
    kpi.changePercent = ((current - previous) / Math.abs(previous)) * 100;
    if (kpi.changePercent > 0.5) kpi.trend = 'up';
    else if (kpi.changePercent < -0.5) kpi.trend = 'down';
  }
  return kpi;
}

function sumAmount<T extends { amount_total: number }>(arr: T[]): number {
  return arr.reduce((a, o) => a + o.amount_total, 0);
}

function sumTips<T extends { tip_amount: number }>(arr: T[]): number {
  return arr.reduce((a, o) => a + (o.tip_amount || 0), 0);
}

function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ═══════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════

export async function computeDashboard(
  location: LocationInfo,
  today: string,
): Promise<DashboardData> {
  const t = new Date(today);
  const year = t.getFullYear();
  const month = t.getMonth() + 1;
  const monthStartStr = monthStart(year, month);

  const lastWeekToday = new Date(t);
  lastWeekToday.setDate(lastWeekToday.getDate() - 7);
  const lastWeekStr = lastWeekToday.toISOString().substring(0, 10);

  const weekStartStr = weekStart(today);
  const weekEndStr = weekEnd(today);
  const lastWeekStartStr = weekStart(lastWeekStr);
  const lastWeekEndStr = weekEnd(lastWeekStr);

  const lmDate = new Date(year, month - 2, 1);
  const lmYear = lmDate.getFullYear();
  const lmMonth = lmDate.getMonth() + 1;
  const lmStart = monthStart(lmYear, lmMonth);
  const lmEnd = monthEnd(lmYear, lmMonth);
  const lmlStart = monthStart(lmYear - 1, lmMonth);
  const lmlEnd = monthEnd(lmYear - 1, lmMonth);

  const ytdStart = `${year}-01-01`;
  const lyYtdStart = `${year - 1}-01-01`;
  const lyYtdEnd = `${year - 1}-${today.substring(5)}`;
  const smlyStart = monthStart(year - 1, month);
  const smlyEnd = monthEnd(year - 1, month);

  const [
    todayOrders, lastWeekTodayOrders,
    thisWeekOrders, lastWeekOrders,
    thisMonthOrders, lastMonthOrders, lastMonthLyOrders, sameMonthLyOrders,
    ytdOrders, lyYtdOrders,
    todayPayments,
  ] = await Promise.all([
    fetchOrders(location.companyId, today, today),
    fetchOrders(location.companyId, lastWeekStr, lastWeekStr),
    fetchOrders(location.companyId, weekStartStr, weekEndStr),
    fetchOrders(location.companyId, lastWeekStartStr, lastWeekEndStr),
    fetchOrders(location.companyId, monthStartStr, today),
    fetchOrders(location.companyId, lmStart, lmEnd),
    fetchOrders(location.companyId, lmlStart, lmlEnd),
    fetchOrders(location.companyId, smlyStart, smlyEnd),
    fetchOrders(location.companyId, ytdStart, today),
    fetchOrders(location.companyId, lyYtdStart, lyYtdEnd),
    fetchPayments(location.companyId, today, today),
  ]);

  const todayRev = sumAmount(todayOrders);
  const lwtRev = sumAmount(lastWeekTodayOrders);
  const weekRev = sumAmount(thisWeekOrders);
  const lwRev = sumAmount(lastWeekOrders);
  const monthRev = sumAmount(thisMonthOrders);
  const lmRev = sumAmount(lastMonthOrders);
  const lmlRev = sumAmount(lastMonthLyOrders);
  const smlyRev = sumAmount(sameMonthLyOrders);
  const ytdRev = sumAmount(ytdOrders);
  const lyYtdRev = sumAmount(lyYtdOrders);

  let cashAmt = 0, cardAmt = 0;
  for (const p of todayPayments as any[]) {
    const method = p.payment_method_id ? String(p.payment_method_id[1]) : '';
    if (method.toLowerCase().includes('cash') || method.toLowerCase().includes('bar')) {
      cashAmt += p.amount;
    } else {
      cardAmt += p.amount;
    }
  }
  const totalPay = cashAmt + cardAmt;

  const lmByDay = new Map<string, { rev: number; orders: number }>();
  for (const o of lastMonthOrders as any[]) {
    const d = utcToBerlinDate(o.date_order);
    const e = lmByDay.get(d) || { rev: 0, orders: 0 };
    e.rev += o.amount_total;
    e.orders += 1;
    lmByDay.set(d, e);
  }
  const lmDays = Array.from(lmByDay.entries());
  const lmBest = lmDays.length
    ? lmDays.reduce((a, b) => (a[1].rev > b[1].rev ? a : b))
    : (['', { rev: 0, orders: 0 }] as [string, { rev: number; orders: number }]);

  const todayAvg = todayOrders.length ? todayRev / todayOrders.length : 0;
  const lwtAvg = lastWeekTodayOrders.length ? lwtRev / lastWeekTodayOrders.length : 0;
  const lmAvg = lastMonthOrders.length ? lmRev / lastMonthOrders.length : 0;
  const lmlAvg = lastMonthLyOrders.length ? lmlRev / lastMonthLyOrders.length : 0;

  const daysInMonth = Math.max(1, new Set((thisMonthOrders as any[]).map(o => utcToBerlinDate(o.date_order))).size);
  const lmDaysCount = Math.max(1, lmDays.length);
  const monthlyDailyAvg = monthRev / daysInMonth;
  const lmDailyAvg = lmRev / lmDaysCount;

  return {
    period: { start: today, end: today },
    location,
    todayRevenue: buildKpi(todayRev, lwtRev),
    todayOrders: buildKpi(todayOrders.length, lastWeekTodayOrders.length, formatNum),
    avgTicket: buildKpi(todayAvg, lwtAvg),
    cashCardSplit: {
      cashAmount: cashAmt, cardAmount: cardAmt,
      cashPct: totalPay ? (cashAmt / totalPay) * 100 : 0,
      cardPct: totalPay ? (cardAmt / totalPay) * 100 : 0,
    },
    thisWeek: buildKpi(weekRev, lwRev),
    thisMonth: buildKpi(monthRev, smlyRev),
    ytd: buildKpi(ytdRev, lyYtdRev),
    dailyAverage: buildKpi(monthlyDailyAvg, lmDailyAvg),
    lastMonth: {
      revenue: buildKpi(lmRev, lmlRev),
      orders: buildKpi(lastMonthOrders.length, lastMonthLyOrders.length, formatNum),
      avgTicket: buildKpi(lmAvg, lmlAvg),
      vsLastYear: buildKpi(lmRev, lmlRev),
      dailyAvg: buildKpi(lmDailyAvg, monthlyDailyAvg),
      bestDay: { date: lmBest[0], revenue: lmBest[1].rev, orders: lmBest[1].orders },
    },
  };
}

// ═══════════════════════════════════════════════════════
// DAILY BREAKDOWN
// ═══════════════════════════════════════════════════════

export async function computeDailyBreakdown(
  location: LocationInfo,
  year: number,
  month: number,
): Promise<DailyBreakdownData> {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const lyStart = monthStart(year - 1, month);
  const lyEnd = monthEnd(year - 1, month);

  const [thisYear, lastYear] = await Promise.all([
    fetchOrders(location.companyId, start, end),
    fetchOrders(location.companyId, lyStart, lyEnd),
  ]);

  const dayMap = new Map<string, { rev: number; orders: number }>();
  const lyDayMap = new Map<string, { rev: number; orders: number }>();

  for (const o of thisYear as any[]) {
    const d = utcToBerlinDate(o.date_order);
    const e = dayMap.get(d) || { rev: 0, orders: 0 };
    e.rev += o.amount_total; e.orders += 1;
    dayMap.set(d, e);
  }
  for (const o of lastYear as any[]) {
    const d = utcToBerlinDate(o.date_order).substring(5);
    const e = lyDayMap.get(d) || { rev: 0, orders: 0 };
    e.rev += o.amount_total; e.orders += 1;
    lyDayMap.set(d, e);
  }

  let bestRev = 0, bestDate = '';
  for (const [d, e] of dayMap.entries()) {
    if (e.rev > bestRev) { bestRev = e.rev; bestDate = d; }
  }

  const days: DailyRow[] = Array.from(dayMap.keys()).sort().map(date => {
    const entry = dayMap.get(date)!;
    const lyEntry = lyDayMap.get(date.substring(5));
    const yoy = lyEntry && lyEntry.rev > 0
      ? ((entry.rev - lyEntry.rev) / lyEntry.rev) * 100 : undefined;
    return {
      date,
      dayOfWeek: dowName(date),
      isWeekend: isWeekend(date),
      orders: entry.orders,
      revenue: entry.rev,
      avgTicket: entry.orders ? entry.rev / entry.orders : 0,
      yoyChangePercent: yoy,
      isBestDay: date === bestDate,
    };
  });

  const totalRev = sumAmount(thisYear as any);
  const lyTotalRev = sumAmount(lastYear as any);

  return {
    period: { start, end },
    location,
    days,
    totals: {
      orders: thisYear.length,
      revenue: totalRev,
      avgTicket: thisYear.length ? totalRev / thisYear.length : 0,
      yoyChangePercent: lyTotalRev > 0 ? ((totalRev - lyTotalRev) / lyTotalRev) * 100 : undefined,
    },
  };
}

// ═══════════════════════════════════════════════════════
// COMPARISON
// ═══════════════════════════════════════════════════════

export type ComparisonType = 'week' | 'month' | 'quarter' | 'year';

export async function computeComparison(
  location: LocationInfo,
  type: ComparisonType,
  referenceDate: string,
): Promise<ComparisonData> {
  const ref = new Date(referenceDate);
  let curStart: string, curEnd: string, prevStart: string, prevEnd: string;
  let curLabel: string, prevLabel: string;

  if (type === 'week') {
    curStart = weekStart(referenceDate);
    curEnd = weekEnd(referenceDate);
    const lw = new Date(ref); lw.setDate(lw.getDate() - 7);
    const lwStr = lw.toISOString().substring(0, 10);
    prevStart = weekStart(lwStr);
    prevEnd = weekEnd(lwStr);
    curLabel = `Week of ${curStart}`;
    prevLabel = `Week of ${prevStart}`;
  } else if (type === 'month') {
    const year = ref.getFullYear();
    const month = ref.getMonth() + 1;
    curStart = monthStart(year, month);
    curEnd = monthEnd(year, month);
    prevStart = monthStart(year - 1, month);
    prevEnd = monthEnd(year - 1, month);
    curLabel = `${year}-${String(month).padStart(2, '0')}`;
    prevLabel = `${year - 1}-${String(month).padStart(2, '0')}`;
  } else if (type === 'quarter') {
    const year = ref.getFullYear();
    const q = Math.floor(ref.getMonth() / 3);
    const qsm = q * 3 + 1;
    curStart = monthStart(year, qsm);
    curEnd = monthEnd(year, qsm + 2);
    prevStart = monthStart(year - 1, qsm);
    prevEnd = monthEnd(year - 1, qsm + 2);
    curLabel = `Q${q + 1} ${year}`;
    prevLabel = `Q${q + 1} ${year - 1}`;
  } else {
    const year = ref.getFullYear();
    curStart = `${year}-01-01`; curEnd = `${year}-12-31`;
    prevStart = `${year - 1}-01-01`; prevEnd = `${year - 1}-12-31`;
    curLabel = String(year); prevLabel = String(year - 1);
  }

  const [curOrders, prevOrders] = await Promise.all([
    fetchOrders(location.companyId, curStart, curEnd),
    fetchOrders(location.companyId, prevStart, prevEnd),
  ]);

  const curRev = sumAmount(curOrders as any);
  const prevRev = sumAmount(prevOrders as any);

  const dayByDay: DayComparison[] = [];
  if (type === 'week') {
    const curByDow = new Map<string, number>();
    const prevByDow = new Map<string, number>();
    for (const o of curOrders as any[]) {
      const dow = dowName(utcToBerlinDate(o.date_order));
      curByDow.set(dow, (curByDow.get(dow) || 0) + o.amount_total);
    }
    for (const o of prevOrders as any[]) {
      const dow = dowName(utcToBerlinDate(o.date_order));
      prevByDow.set(dow, (prevByDow.get(dow) || 0) + o.amount_total);
    }
    for (const dow of DOW_NAMES) {
      const c = curByDow.get(dow) || 0;
      const p = prevByDow.get(dow) || 0;
      dayByDay.push({
        day: dow, current: c, previous: p,
        changePercent: p > 0 ? ((c - p) / p) * 100 : 0,
      });
    }
  }

  const current: ComparisonPeriod = {
    label: curLabel, range: { start: curStart, end: curEnd },
    revenue: curRev, orders: curOrders.length,
    avgTicket: curOrders.length ? curRev / curOrders.length : 0,
  };
  const previous: ComparisonPeriod = {
    label: prevLabel, range: { start: prevStart, end: prevEnd },
    revenue: prevRev, orders: prevOrders.length,
    avgTicket: prevOrders.length ? prevRev / prevOrders.length : 0,
  };

  return {
    current, previous, dayByDay,
    revenueChange: buildKpi(curRev, prevRev),
    orderVolumeChange: buildKpi(curOrders.length, prevOrders.length, formatNum),
    avgTicketChange: buildKpi(current.avgTicket, previous.avgTicket),
  };
}

// ═══════════════════════════════════════════════════════
// RECORDS & AVERAGES
// ═══════════════════════════════════════════════════════

export async function computeRecords(
  location: LocationInfo,
  referenceDate: string,
): Promise<RecordsData> {
  const ref = new Date(referenceDate);
  const year = ref.getFullYear();
  const month = ref.getMonth() + 1;
  const mStart = monthStart(year, month);
  const mEnd = monthEnd(year, month);

  const [monthOrders, ytdOrders] = await Promise.all([
    fetchOrders(location.companyId, mStart, mEnd),
    fetchOrders(location.companyId, `${year}-01-01`, referenceDate),
  ]);

  const byDay = new Map<string, { rev: number; orders: number }>();
  for (const o of ytdOrders as any[]) {
    const d = utcToBerlinDate(o.date_order);
    const e = byDay.get(d) || { rev: 0, orders: 0 };
    e.rev += o.amount_total; e.orders += 1;
    byDay.set(d, e);
  }

  const dayEntries = Array.from(byDay.entries()).sort((a, b) => b[1].rev - a[1].rev);
  const bestDays: RecordEntry[] = dayEntries.slice(0, 5).map((entry, i) => ({
    label: i === 0 ? `Best Day (${year} YTD)` : `Rank ${i + 1}`,
    detail: `${dowName(entry[0])}, ${entry[0]}`,
    value: entry[1].rev,
    formatted: formatEur(entry[1].rev),
  }));

  const byWeek = new Map<string, number>();
  for (const [date, entry] of byDay.entries()) {
    const ws = weekStart(date);
    byWeek.set(ws, (byWeek.get(ws) || 0) + entry.rev);
  }
  const weekEntries = Array.from(byWeek.entries()).sort((a, b) => b[1] - a[1]);
  const bestWeeks: RecordEntry[] = weekEntries.slice(0, 3).map((entry, i) => ({
    label: i === 0 ? `Best Week (${year} YTD)` : `Rank ${i + 1}`,
    detail: `Week of ${entry[0]}`,
    value: entry[1],
    formatted: formatEur(entry[1]),
  }));

  const byMonth = new Map<string, number>();
  for (const o of ytdOrders as any[]) {
    const m = utcToBerlinDate(o.date_order).substring(0, 7);
    byMonth.set(m, (byMonth.get(m) || 0) + o.amount_total);
  }
  const monthEntries = Array.from(byMonth.entries()).sort((a, b) => b[1] - a[1]);
  const bestMonths: RecordEntry[] = monthEntries.slice(0, 3).map((entry, i) => ({
    label: i === 0 ? `Best Month (${year})` : `Rank ${i + 1}`,
    detail: entry[0],
    value: entry[1],
    formatted: formatEur(entry[1]),
  }));

  const monthRev = sumAmount(monthOrders as any);
  const ytdRev = sumAmount(ytdOrders as any);
  const monthDays = new Set((monthOrders as any[]).map(o => utcToBerlinDate(o.date_order))).size || 1;
  const ytdDays = byDay.size || 1;

  return {
    location,
    bestDays, bestWeeks, bestMonths,
    averages: {
      dailyAvgMonth: monthRev / monthDays,
      dailyAvgYtd: ytdRev / ytdDays,
      weeklyAvgMonth: monthRev / Math.max(1, Math.ceil(monthDays / 7)),
      avgTicketMonth: monthOrders.length ? monthRev / monthOrders.length : 0,
      avgOrdersPerDayMonth: monthOrders.length / monthDays,
    },
  };
}

// ═══════════════════════════════════════════════════════
// P&L
// ═══════════════════════════════════════════════════════

const ACCOUNT_TYPES_EXPENSE = ['expense', 'expense_direct_cost', 'expense_depreciation'];

function categorizeAccount(code: string): string {
  if (code.startsWith('83')) return 'revenue_food';
  if (code.startsWith('84')) return 'revenue_drinks';
  if (code.startsWith('5')) return 'cogs_food';
  if (code.startsWith('4130') || code.startsWith('4131')) return 'social';
  if (code.startsWith('41')) return 'wages';
  if (code.startsWith('421')) return 'rent';
  if (code.startsWith('4240') || code.startsWith('425')) return 'utilities';
  if (code.startsWith('4360') || code.startsWith('4361')) return 'insurance';
  if (code.startsWith('4') || code.startsWith('6') || code.startsWith('7')) return 'other_opex';
  return 'other';
}

function aggregateMoveLines(lines: Array<{ account_id: [number, string]; debit: number; credit: number }>) {
  const result = {
    cogs_food: 0, cogs_packaging: 0,
    wages: 0, social: 0, rent: 0,
    utilities: 0, insurance: 0, other_opex: 0,
  };
  for (const l of lines) {
    if (!l.account_id) continue;
    const codeMatch = String(l.account_id[1]).match(/^(\d+)/);
    const code = codeMatch ? codeMatch[1] : '';
    const cat = categorizeAccount(code);
    const amount = l.debit - l.credit;
    if (cat === 'cogs_food') result.cogs_food += amount;
    else if (cat === 'wages') result.wages += amount;
    else if (cat === 'social') result.social += amount;
    else if (cat === 'rent') result.rent += amount;
    else if (cat === 'utilities') result.utilities += amount;
    else if (cat === 'insurance') result.insurance += amount;
    else if (cat === 'other_opex') result.other_opex += amount;
  }
  return result;
}

export async function computePnl(
  location: LocationInfo,
  year: number,
  month: number,
): Promise<PnlData> {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const lyStart = monthStart(year - 1, month);
  const lyEnd = monthEnd(year - 1, month);

  const [curOrders, prevOrders, curMoveLines, prevMoveLines] = await Promise.all([
    fetchOrders(location.companyId, start, end),
    fetchOrders(location.companyId, lyStart, lyEnd),
    fetchAccountMoveLines(location.companyId, start, end, ACCOUNT_TYPES_EXPENSE),
    fetchAccountMoveLines(location.companyId, lyStart, lyEnd, ACCOUNT_TYPES_EXPENSE),
  ]);

  const curRev = sumAmount(curOrders as any);
  const prevRev = sumAmount(prevOrders as any);
  const curTips = sumTips(curOrders as any);

  const cur = aggregateMoveLines(curMoveLines as any);
  const prev = aggregateMoveLines(prevMoveLines as any);

  const foodPct = location.type === 'counter' ? 0.974 : 0.735;
  const food = (curRev - curTips) * foodPct;
  const drinks = (curRev - curTips) * (1 - foodPct);

  const curCogs = cur.cogs_food + cur.cogs_packaging;
  const prevCogs = prev.cogs_food + prev.cogs_packaging;
  const curOpex = cur.wages + cur.social + cur.rent + cur.utilities + cur.insurance + cur.other_opex;
  const prevOpex = prev.wages + prev.social + prev.rent + prev.utilities + prev.insurance + prev.other_opex;

  const curGross = curRev - curCogs;
  const prevGross = prevRev - prevCogs;
  const curNet = curGross - curOpex;
  const prevNet = prevGross - prevOpex;

  const r = (v: number, total: number) => total ? (v / total) * 100 : 0;
  const grossMargin = r(curGross, curRev);
  const prevGrossMargin = r(prevGross, prevRev);
  const netMargin = r(curNet, curRev);
  const prevNetMargin = r(prevNet, prevRev);
  const foodCostPct = r(curCogs, curRev);
  const prevFoodCostPct = r(prevCogs, prevRev);
  const laborCostPct = r(cur.wages + cur.social, curRev);
  const prevLaborCostPct = r(prev.wages + prev.social, prevRev);
  const primeCost = foodCostPct + laborCostPct;
  const prevPrimeCost = prevFoodCostPct + prevLaborCostPct;
  const fixedCostRatio = r(cur.rent + cur.utilities + cur.insurance, curRev);
  const prevFixedCostRatio = r(prev.rent + prev.utilities + prev.insurance, prevRev);
  const opexRatio = r(curOpex, curRev);
  const prevOpexRatio = r(prevOpex, prevRev);
  const revPerLabor = (cur.wages + cur.social) > 0 ? curRev / (cur.wages + cur.social) : 0;
  const prevRevPerLabor = (prev.wages + prev.social) > 0 ? prevRev / (prev.wages + prev.social) : 0;

  const fixedTotal = cur.rent + cur.utilities + cur.insurance + cur.wages + cur.social + cur.other_opex;
  const monthlyBE = grossMargin > 0 ? (fixedTotal / (grossMargin / 100)) : 0;
  const headroomPct = monthlyBE ? ((curRev - monthlyBE) / monthlyBE) * 100 : 0;
  const daysOpen = new Set((curOrders as any[]).map(o => utcToBerlinDate(o.date_order))).size || 30;
  const dailyBE = monthlyBE / daysOpen;
  const dailyAvg = curRev / daysOpen;

  const controllable = curRev - curCogs - (cur.wages + cur.social);
  const prevControllable = prevRev - prevCogs - (prev.wages + prev.social);
  const controllableMargin = r(controllable, curRev);
  const prevControllableMargin = r(prevControllable, prevRev);

  const ratios: PnlRatio[] = [
    { id: 'prime_cost', label: 'Prime Cost', value: primeCost, previousValue: prevPrimeCost,
      target: 65, targetLabel: '< 65%', changePp: primeCost - prevPrimeCost,
      status: primeCost > 70 ? 'bad' : primeCost > 65 ? 'warn' : 'good',
      breakdown: [
        { label: 'Food', value: foodCostPct, color: 'var(--cyan)' },
        { label: 'Labor', value: laborCostPct, color: 'var(--purple)' },
      ],
      infoText: 'The single most important metric in restaurant management.',
      formula: '( COGS + Labor ) / Revenue * 100',
      benchmarks: [
        { label: 'Under 60% = Excellent', color: 'var(--green)' },
        { label: '60-65% = Healthy', color: 'var(--amber)' },
        { label: 'Over 65% = Action needed', color: 'var(--red)' },
      ],
    },
    { id: 'food_cost', label: 'Food Cost %', value: foodCostPct, previousValue: prevFoodCostPct,
      target: 33, targetLabel: '< 33%', changePp: foodCostPct - prevFoodCostPct,
      status: foodCostPct > 35 ? 'bad' : foodCostPct > 33 ? 'warn' : 'good',
      infoText: 'COGS as a percentage of revenue.',
      formula: 'COGS / Revenue * 100',
    },
    { id: 'labor_cost', label: 'Labor Cost %', value: laborCostPct, previousValue: prevLaborCostPct,
      target: 35, targetLabel: '< 35%', changePp: laborCostPct - prevLaborCostPct,
      status: laborCostPct > 37 ? 'bad' : laborCostPct > 35 ? 'warn' : 'good',
      breakdown: [
        { label: `Wages: ${formatEur(cur.wages)}`, value: cur.wages, color: 'var(--accent)' },
        { label: `Social: ${formatEur(cur.social)}`, value: cur.social, color: 'var(--purple)' },
      ],
      infoText: 'Total labor spend (wages, social) as a share of revenue.',
      formula: '( Wages + Social ) / Revenue * 100',
    },
    { id: 'gross_margin', label: 'Gross Margin', value: grossMargin, previousValue: prevGrossMargin,
      target: 65, targetLabel: '> 65%', changePp: grossMargin - prevGrossMargin,
      status: grossMargin < 60 ? 'bad' : grossMargin < 65 ? 'warn' : 'good',
      infoText: 'What you keep after paying for ingredients and drinks.',
      formula: '( Revenue - COGS ) / Revenue * 100',
    },
    { id: 'net_margin', label: 'Net Margin', value: netMargin, previousValue: prevNetMargin,
      target: 10, targetLabel: '> 10%', changePp: netMargin - prevNetMargin,
      status: netMargin < 5 ? 'bad' : netMargin < 10 ? 'warn' : 'good',
      infoText: 'Bottom line profit as a percentage of revenue.',
      formula: 'Net Profit / Revenue * 100',
    },
    { id: 'fixed_cost', label: 'Fixed Cost Ratio', value: fixedCostRatio, previousValue: prevFixedCostRatio,
      target: 20, targetLabel: '< 20%', changePp: fixedCostRatio - prevFixedCostRatio,
      status: fixedCostRatio > 25 ? 'bad' : fixedCostRatio > 20 ? 'warn' : 'good',
      infoText: 'Share of revenue consumed by costs that do not change with volume.',
      formula: '( Rent + Insurance + Utilities ) / Revenue * 100',
    },
    { id: 'opex_ratio', label: 'OpEx / Revenue', value: opexRatio, previousValue: prevOpexRatio,
      changePp: opexRatio - prevOpexRatio,
      status: opexRatio > 60 ? 'bad' : opexRatio > 55 ? 'warn' : 'good',
      infoText: 'All operating expenses combined as a share of revenue.',
      formula: 'Total OpEx / Revenue * 100',
    },
    { id: 'rev_per_labor', label: 'Revenue per €1 Labor', value: revPerLabor, previousValue: prevRevPerLabor,
      changePp: revPerLabor - prevRevPerLabor,
      status: revPerLabor > 3 ? 'good' : revPerLabor > 2.5 ? 'warn' : 'bad',
      infoText: 'For every euro on labor, how many euros come back as revenue.',
      formula: 'Revenue / Total Labor Cost',
    },
    { id: 'monthly_breakeven', label: 'Monthly Break-Even', value: monthlyBE, previousValue: 0,
      changePp: 0,
      status: headroomPct > 15 ? 'good' : headroomPct > 5 ? 'warn' : 'bad',
      infoText: 'Minimum monthly revenue needed to cover all costs with zero profit.',
      formula: 'Fixed Costs / Gross Margin %',
    },
    { id: 'daily_breakeven', label: 'Daily Break-Even', value: dailyBE, previousValue: dailyAvg,
      changePp: 0,
      status: dailyAvg > dailyBE * 1.15 ? 'good' : 'warn',
      infoText: 'Days below this lose money.',
      formula: 'Monthly Break-Even / Days Open',
    },
    { id: 'controllable_profit', label: 'Controllable Profit', value: controllable, previousValue: prevControllable,
      changePp: 0,
      status: controllable > prevControllable ? 'good' : 'warn',
      infoText: 'Revenue minus costs a manager can directly influence: food and labor.',
      formula: 'Revenue - COGS - Labor',
    },
    { id: 'controllable_margin', label: 'Controllable Margin', value: controllableMargin, previousValue: prevControllableMargin,
      target: 25, targetLabel: '> 25%', changePp: controllableMargin - prevControllableMargin,
      status: controllableMargin > 30 ? 'good' : controllableMargin > 25 ? 'warn' : 'bad',
      infoText: 'Best metric for benchmarking location managers fairly.',
      formula: 'Controllable Profit / Revenue * 100',
    },
  ];

  const pct = (cur: number, prev: number) =>
    prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0;

  const lineItems: PnlLineItem[] = [
    { label: 'POS Sales 7% (Food)', currentAmount: food, previousAmount: prevRev * foodPct, changePercent: pct(food, prevRev * foodPct), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'POS Sales 19% (Drinks)', currentAmount: drinks, previousAmount: prevRev * (1 - foodPct), changePercent: pct(drinks, prevRev * (1 - foodPct)), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'Total Revenue', currentAmount: curRev, previousAmount: prevRev, changePercent: pct(curRev, prevRev), indent: 0, isSubtotal: true, isGrandTotal: false },
    { label: 'Food & Beverage Purchases', currentAmount: -cur.cogs_food, previousAmount: -prev.cogs_food, changePercent: pct(cur.cogs_food, prev.cogs_food), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'Total COGS', currentAmount: -curCogs, previousAmount: -prevCogs, changePercent: pct(curCogs, prevCogs), indent: 0, isSubtotal: true, isGrandTotal: false },
    { label: 'Gross Profit', currentAmount: curGross, previousAmount: prevGross, changePercent: pct(curGross, prevGross), indent: 0, isSubtotal: true, isGrandTotal: false },
    { label: 'Wages & Salaries', currentAmount: -cur.wages, previousAmount: -prev.wages, changePercent: pct(cur.wages, prev.wages), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'Social Contributions', currentAmount: -cur.social, previousAmount: -prev.social, changePercent: pct(cur.social, prev.social), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'Rent', currentAmount: -cur.rent, previousAmount: -prev.rent, changePercent: pct(cur.rent, prev.rent), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'Utilities & Telecom', currentAmount: -cur.utilities, previousAmount: -prev.utilities, changePercent: pct(cur.utilities, prev.utilities), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'Insurance', currentAmount: -cur.insurance, previousAmount: -prev.insurance, changePercent: pct(cur.insurance, prev.insurance), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'Other Operating Expenses', currentAmount: -cur.other_opex, previousAmount: -prev.other_opex, changePercent: pct(cur.other_opex, prev.other_opex), indent: 1, isSubtotal: false, isGrandTotal: false },
    { label: 'Total Operating Expenses', currentAmount: -curOpex, previousAmount: -prevOpex, changePercent: pct(curOpex, prevOpex), indent: 0, isSubtotal: true, isGrandTotal: false },
    { label: 'Net Profit / (Loss)', currentAmount: curNet, previousAmount: prevNet, changePercent: pct(curNet, prevNet), indent: 0, isSubtotal: false, isGrandTotal: true },
  ];

  return {
    period: { start, end },
    comparisonPeriod: { start: lyStart, end: lyEnd },
    location,
    ratios, lineItems,
    revenue: { food, drinks, tips: curTips, total: curRev },
    cogs: { foodBev: cur.cogs_food, packaging: cur.cogs_packaging, total: curCogs },
    opex: {
      wages: cur.wages, social: cur.social, rent: cur.rent,
      utilities: cur.utilities, insurance: cur.insurance,
      other: cur.other_opex, total: curOpex,
    },
    grossProfit: curGross, netProfit: curNet,
  };
}

// ═══════════════════════════════════════════════════════
// OPERATIONS (tip analysis, hourly, cashiers, RevPASH, Benford)
// ═══════════════════════════════════════════════════════

function expectedBenford(d: number): number {
  return Math.log10(1 + 1 / d) * 100;
}

export async function computeOperations(
  location: LocationInfo,
  year: number,
  month: number,
): Promise<OperationsData> {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);

  const [orders, payments, sessions, tables, refunds] = await Promise.all([
    fetchOrders(location.companyId, start, end),
    fetchPayments(location.companyId, start, end),
    fetchSessions(location.id, 30),
    fetchTables(location.id),
    fetchRefunds(location.companyId, start, end),
  ]);

  const orderPayment = new Map<number, string>();
  const orderPaymentAmount = new Map<number, number>();
  for (const p of payments as any[]) {
    const oid = p.pos_order_id ? p.pos_order_id[0] : 0;
    if (!oid) continue;
    const method = p.payment_method_id ? String(p.payment_method_id[1]) : 'Unknown';
    const existing = orderPaymentAmount.get(oid) || 0;
    if (p.amount > existing) {
      orderPaymentAmount.set(oid, p.amount);
      orderPayment.set(oid, method);
    }
  }

  let cashAmt = 0, cardAmt = 0, cashCount = 0, cardCount = 0;
  for (const p of payments as any[]) {
    const method = p.payment_method_id ? String(p.payment_method_id[1]).toLowerCase() : '';
    if (method.includes('cash') || method.includes('bar')) {
      cashAmt += p.amount; cashCount++;
    } else {
      cardAmt += p.amount; cardCount++;
    }
  }
  const totalPay = cashAmt + cardAmt;
  const paymentSplits: PaymentMethodSplit[] = [{
    location,
    cash: { count: cashCount, amount: cashAmt, pct: totalPay ? (cashAmt / totalPay) * 100 : 0 },
    card: { count: cardCount, amount: cardAmt, pct: totalPay ? (cardAmt / totalPay) * 100 : 0 },
  }];

  const hourly = new Map<number, { orders: number; rev: number }>();
  for (const o of orders as any[]) {
    const h = utcToBerlinHour(o.date_order);
    const e = hourly.get(h) || { orders: 0, rev: 0 };
    e.orders += 1; e.rev += o.amount_total;
    hourly.set(h, e);
  }
  let peakHour = 0, peakOrders = 0;
  for (const [h, e] of hourly.entries()) {
    if (e.orders > peakOrders) { peakOrders = e.orders; peakHour = h; }
  }
  const hourlyDistribution: HourlyBucket[] = [];
  for (let h = 0; h < 24; h++) {
    const e = hourly.get(h);
    if (e) hourlyDistribution.push({ hour: h, orders: e.orders, revenue: e.rev, isPeak: h === peakHour });
  }

  // Cashier performance (with tip gap detection)
  const emps = new Map<number, {
    name: string; orders: number; rev: number;
    cashOrders: number; cashRev: number; cashTips: number; cashTipped: number;
    cardOrders: number; cardRev: number; cardTips: number; cardTipped: number;
  }>();
  for (const o of orders as any[]) {
    if (!o.employee_id) continue;
    const id = o.employee_id[0];
    const name = String(o.employee_id[1]);
    const entry = emps.get(id) || {
      name, orders: 0, rev: 0,
      cashOrders: 0, cashRev: 0, cashTips: 0, cashTipped: 0,
      cardOrders: 0, cardRev: 0, cardTips: 0, cardTipped: 0,
    };
    entry.orders++; entry.rev += o.amount_total;
    const method = (orderPayment.get(o.id) || '').toLowerCase();
    const isCash = method.includes('cash') || method.includes('bar');
    if (isCash) {
      entry.cashOrders++; entry.cashRev += o.amount_total; entry.cashTips += o.tip_amount;
      if (o.tip_amount > 0) entry.cashTipped++;
    } else {
      entry.cardOrders++; entry.cardRev += o.amount_total; entry.cardTips += o.tip_amount;
      if (o.tip_amount > 0) entry.cardTipped++;
    }
    emps.set(id, entry);
  }

  const totalEmpRev = Array.from(emps.values()).reduce((a, e) => a + e.rev, 0);

  const empRefunds = new Map<number, { count: number; amount: number }>();
  for (const r of refunds as any[]) {
    if (!r.employee_id) continue;
    const id = r.employee_id[0];
    const e = empRefunds.get(id) || { count: 0, amount: 0 };
    e.count++; e.amount += Math.abs(r.amount_total);
    empRefunds.set(id, e);
  }

  const cashierPerformance: CashierPerformance[] = Array.from(emps.entries())
    .map(([id, e]) => {
      const cashRatio = e.cashRev ? (e.cashTips / e.cashRev) * 100 : 0;
      const cardRatio = e.cardRev ? (e.cardTips / e.cardRev) * 100 : 0;
      const gap = cardRatio - cashRatio;
      const flagged = Math.abs(gap) > 3 && e.cashOrders >= 10 && e.cardOrders >= 10;
      const ref = empRefunds.get(id) || { count: 0, amount: 0 };
      return {
        employeeId: id,
        name: e.name,
        orders: e.orders,
        revenue: e.rev,
        avgTicket: e.orders ? e.rev / e.orders : 0,
        sharePct: totalEmpRev ? (e.rev / totalEmpRev) * 100 : 0,
        refunds: ref.count,
        refundAmount: ref.amount,
        refundRate: e.orders ? (ref.count / e.orders) * 100 : 0,
        cashTipRatio: cashRatio,
        cardTipRatio: cardRatio,
        tipGapPp: gap,
        flagged,
        flagReason: flagged ? `Cash tip ratio ${cashRatio.toFixed(1)}% vs card ${cardRatio.toFixed(1)}% — ${gap.toFixed(1)}pp gap` : undefined,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // Order composition (items per order)
  const lines = orders.length ? await fetchOrderLines(location.companyId, start, end) : [];
  const orderItemCount = new Map<number, number>();
  for (const l of lines as any[]) {
    const oid = l.order_id ? l.order_id[0] : 0;
    orderItemCount.set(oid, (orderItemCount.get(oid) || 0) + l.qty);
  }
  const buckets: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  for (const qty of orderItemCount.values()) {
    const b = qty >= 5 ? '5+' : String(Math.max(1, Math.floor(qty)));
    buckets[b] = (buckets[b] || 0) + 1;
  }
  const totalOrdersCount = Object.values(buckets).reduce((a, b) => a + b, 0);
  const orderComposition: OrderComposition[] = Object.entries(buckets).map(([bucket, count]) => ({
    bucket, count, pct: totalOrdersCount ? (count / totalOrdersCount) * 100 : 0,
  }));

  // Table performance (sitdown only)
  const tablePerformance: TablePerformance[] = [];
  if (location.type === 'sitdown') {
    const byTable = new Map<number, { name: string; orders: number; rev: number; tips: number }>();
    for (const o of orders as any[]) {
      if (!o.table_id) continue;
      const tid = o.table_id[0];
      const tname = String(o.table_id[1]);
      const e = byTable.get(tid) || { name: tname, orders: 0, rev: 0, tips: 0 };
      e.orders++; e.rev += o.amount_total; e.tips += o.tip_amount;
      byTable.set(tid, e);
    }
    for (const [tid, e] of byTable.entries()) {
      tablePerformance.push({
        tableId: tid, tableName: e.name,
        orders: e.orders, revenue: e.rev,
        avgCheck: e.orders ? e.rev / e.orders : 0,
        tips: e.tips,
        tipPct: e.rev ? (e.tips / e.rev) * 100 : 0,
      });
    }
    tablePerformance.sort((a, b) => b.revenue - a.revenue);
  }

  // Tip analysis
  const totalRev = sumAmount(orders as any);
  const totalTips = sumTips(orders as any);
  const tipped = (orders as any[]).filter(o => o.tip_amount > 0).length;
  const tipSalesRatio = totalRev ? (totalTips / totalRev) * 100 : 0;
  const tipRate = orders.length ? (tipped / orders.length) * 100 : 0;
  const avgTipWhenTipped = tipped ? totalTips / tipped : 0;

  const tipByEmployee: TipByEmployee[] = Array.from(emps.entries()).map(([, e]) => {
    const cashRatio = e.cashRev ? (e.cashTips / e.cashRev) * 100 : 0;
    const cardRatio = e.cardRev ? (e.cardTips / e.cardRev) * 100 : 0;
    const empTips = e.cashTips + e.cardTips;
    const empTipped = e.cashTipped + e.cardTipped;
    const cashZeroPct = e.cashOrders ? ((e.cashOrders - e.cashTipped) / e.cashOrders) * 100 : 0;
    const cardZeroPct = e.cardOrders ? ((e.cardOrders - e.cardTipped) / e.cardOrders) * 100 : 0;
    return {
      name: e.name, orders: e.orders, revenue: e.rev,
      tips: empTips,
      tipSalesRatio: e.rev ? (empTips / e.rev) * 100 : 0,
      tipRate: e.orders ? (empTipped / e.orders) * 100 : 0,
      avgTip: empTipped ? empTips / empTipped : 0,
      cashTipRatio: cashRatio, cardTipRatio: cardRatio,
      tipGapPp: cardRatio - cashRatio,
      cashZeroTipPct: cashZeroPct, cardZeroTipPct: cardZeroPct,
      flagged: Math.abs(cardRatio - cashRatio) > 3 && e.cashOrders >= 10 && e.cardOrders >= 10,
    };
  }).sort((a, b) => b.tips - a.tips);

  const dowMap = new Map<string, { rev: number; tips: number; orders: number }>();
  for (const o of orders as any[]) {
    const dow = dowName(utcToBerlinDate(o.date_order));
    const e = dowMap.get(dow) || { rev: 0, tips: 0, orders: 0 };
    e.rev += o.amount_total; e.tips += o.tip_amount; e.orders++;
    dowMap.set(dow, e);
  }
  const tipByDow: TipByDayOfWeek[] = DOW_NAMES.map(dow => {
    const e = dowMap.get(dow) || { rev: 0, tips: 0, orders: 0 };
    return {
      day: dow, orders: e.orders, revenue: e.rev, tips: e.tips,
      tipSalesRatio: e.rev ? (e.tips / e.rev) * 100 : 0,
    };
  });

  // Daily tip volatility per employee
  const empDaily = new Map<number, Map<string, { rev: number; tips: number }>>();
  for (const o of orders as any[]) {
    if (!o.employee_id) continue;
    const id = o.employee_id[0];
    const day = utcToBerlinDate(o.date_order);
    if (!empDaily.has(id)) empDaily.set(id, new Map());
    const dayMap = empDaily.get(id)!;
    const e = dayMap.get(day) || { rev: 0, tips: 0 };
    e.rev += o.amount_total; e.tips += o.tip_amount;
    dayMap.set(day, e);
  }
  const tipVolatility: DailyTipVolatility[] = [];
  let minCv = Infinity, mostConsistentName = '';
  for (const [id, days] of empDaily.entries()) {
    const ratios = Array.from(days.values())
      .filter(d => d.rev > 50)
      .map(d => (d.tips / d.rev) * 100);
    if (ratios.length < 3) continue;
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const sd = stdev(ratios);
    const cv = mean ? (sd / mean) * 100 : 0;
    if (cv < minCv) { minCv = cv; mostConsistentName = emps.get(id)!.name; }
    tipVolatility.push({
      name: emps.get(id)!.name,
      daysWorked: ratios.length,
      meanRatio: mean, stdev: sd, cv,
      rangeMin: Math.min(...ratios),
      rangeMax: Math.max(...ratios),
      below1Sigma: ratios.filter(r => r < mean - sd).length,
      below2Sigma: ratios.filter(r => r < mean - 2 * sd).length,
      mostConsistent: false,
    });
  }
  tipVolatility.forEach(v => { if (v.name === mostConsistentName) v.mostConsistent = true; });

  // Monthly trend (last 3 months)
  const tipTrend: TipMonthlyTrend[] = [];
  for (let i = 2; i >= 0; i--) {
    const md = new Date(year, month - 1 - i, 1);
    const my = md.getFullYear();
    const mm = md.getMonth() + 1;
    const ms = monthStart(my, mm);
    const me = monthEnd(my, mm);
    const mOrders = i === 0 ? orders : await fetchOrders(location.companyId, ms, me);
    const rev = sumAmount(mOrders as any);
    const tips = sumTips(mOrders as any);
    const tipped2 = (mOrders as any[]).filter(o => o.tip_amount > 0).length;
    tipTrend.push({
      month: `${md.toLocaleString('en-US', { month: 'short' })} ${my}`,
      revenue: rev, tips,
      tipSalesRatio: rev ? (tips / rev) * 100 : 0,
      tipRate: mOrders.length ? (tipped2 / mOrders.length) * 100 : 0,
      changePp: 0,
    });
  }
  for (let i = 1; i < tipTrend.length; i++) {
    tipTrend[i].changePp = tipTrend[i].tipSalesRatio - tipTrend[i - 1].tipSalesRatio;
  }

  const sessionCashDiffs: SessionCashDiff[] = (sessions as any[]).map(s => ({
    sessionName: s.name,
    date: String(s.start_at).substring(0, 10),
    orderCount: s.order_count,
    cashDifference: s.cash_register_difference,
    flagged: Math.abs(s.cash_register_difference) > 5,
  }));

  // RevPASH
  let revpash: RevPASH | undefined;
  if (location.type === 'sitdown' && tables.length > 0) {
    const totalSeats = (tables as any[]).reduce((a, t) => a + (t.seats || 4), 0);
    const daysCount = new Set((orders as any[]).map(o => utcToBerlinDate(o.date_order))).size || 30;
    const hoursPerDay = 7;
    const seatHours = totalSeats * daysCount * hoursPerDay;
    const revExclTips = totalRev - totalTips;
    revpash = {
      totalSeats, totalTables: tables.length,
      daysOpen: daysCount, hoursPerDay,
      availableSeatHours: seatHours,
      revenueExclTips: revExclTips,
      revpash: seatHours ? revExclTips / seatHours : 0,
      revenuePerTable: tables.length ? revExclTips / tables.length : 0,
      tableTurnsPerDay: tables.length && daysCount ? orders.length / tables.length / daysCount : 0,
    };
  }

  // Benford's Law
  const benfordDigits: { digit: number; observed: number; expected: number; deviation: number; flagged: boolean }[] = [];
  const cashAmounts = (payments as any[])
    .filter(p => {
      const m = p.payment_method_id ? String(p.payment_method_id[1]).toLowerCase() : '';
      return (m.includes('cash') || m.includes('bar')) && p.amount >= 1;
    })
    .map(p => p.amount);
  if (cashAmounts.length >= 100) {
    const counts: Record<number, number> = {};
    for (const amt of cashAmounts) {
      const s = String(amt).replace(/[^0-9]/g, '').replace(/^0+/, '');
      if (!s) continue;
      const d = parseInt(s[0]);
      if (d >= 1 && d <= 9) counts[d] = (counts[d] || 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    for (let d = 1; d <= 9; d++) {
      const observed = ((counts[d] || 0) / total) * 100;
      const expected = expectedBenford(d);
      benfordDigits.push({
        digit: d, observed, expected,
        deviation: observed - expected,
        flagged: Math.abs(observed - expected) > 5,
      });
    }
  }

  // Sequence gaps
  const seqNums: number[] = [];
  for (const o of orders as any[]) {
    const m = o.name.match(/\/(\d+)/);
    if (m) seqNums.push(parseInt(m[1]));
  }
  seqNums.sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < seqNums.length; i++) {
    if (seqNums[i] - seqNums[i - 1] > 1) gaps++;
  }

  return {
    period: { start, end },
    paymentSplits,
    hourlyDistribution,
    cashierPerformance,
    orderComposition,
    tablePerformance,
    tipHeadline: {
      tipSalesRatio: buildKpi(tipSalesRatio, undefined, v => `${v.toFixed(1)}%`),
      totalTips: buildKpi(totalTips, undefined),
      tipRate: buildKpi(tipRate, undefined, v => `${v.toFixed(1)}%`),
      avgTipWhenTipped: buildKpi(avgTipWhenTipped, undefined),
    },
    tipByEmployee,
    tipByDow,
    tipTrend,
    tipVolatility,
    revpash,
    sessionCashDiffs,
    benfordDigits: benfordDigits.length > 0 ? benfordDigits : undefined,
    sequenceGaps: {
      found: gaps,
      rangeStart: seqNums[0] || 0,
      rangeEnd: seqNums[seqNums.length - 1] || 0,
      totalOrders: seqNums.length,
    },
  };
}

// ═══════════════════════════════════════════════════════
// MENU INTELLIGENCE
// ═══════════════════════════════════════════════════════

export async function computeMenu(year: number, month: number): Promise<MenuData> {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const locations = getActiveLocations();

  const drinkFoodRatios: DrinkFoodRatio[] = [];
  const topSellers: MenuData['topSellers'] = [];
  const categoryMix: MenuData['categoryMix'] = [];

  for (const loc of locations) {
    const lines = await fetchOrderLines(loc.companyId, start, end);

    let food = 0, drinks = 0, tips = 0, other = 0;
    const productMap = new Map<number, { name: string; qty: number; revenue: number }>();

    for (const l of lines as any[]) {
      const pname = l.product_id ? String(l.product_id[1]) : '';
      const pid = l.product_id ? l.product_id[0] : 0;
      const incl = l.price_subtotal_incl;
      const sub = l.price_subtotal;

      if (pname.toLowerCase().includes('tip')) {
        tips += incl;
      } else if (sub > 0) {
        const taxPct = (incl / sub - 1) * 100;
        if (taxPct > 15) drinks += incl;
        else if (taxPct > 3) food += incl;
        else other += incl;
      } else {
        other += incl;
      }

      if (pid > 0 && !pname.toLowerCase().includes('tip')) {
        const e = productMap.get(pid) || { name: pname, qty: 0, revenue: 0 };
        e.qty += l.qty; e.revenue += incl;
        productMap.set(pid, e);
      }
    }

    const total = food + drinks + tips + other;
    drinkFoodRatios.push({
      location: loc,
      foodRevenue: food,
      foodPct: total ? (food / total) * 100 : 0,
      drinkRevenue: drinks,
      drinkPct: total ? (drinks / total) * 100 : 0,
      tipRevenue: tips,
      tipPct: total ? (tips / total) * 100 : 0,
      ratio: drinks > 0 ? `1:${(food / drinks).toFixed(1)}` : 'N/A',
    });

    const sorted = Array.from(productMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
    const totalRev = sorted.reduce((a, [, p]) => a + p.revenue, 0);
    let cumulative = 0;
    const products: ProductSales[] = sorted.slice(0, 20).map(([pid, p], i) => {
      const mixPct = totalRev ? (p.revenue / totalRev) * 100 : 0;
      cumulative += mixPct;
      return {
        rank: i + 1, productId: pid, name: p.name,
        qty: p.qty, revenue: p.revenue,
        mixPct, cumulativePct: cumulative,
      };
    });
    topSellers.push({ location: loc, products, uniqueProducts: productMap.size });

    const productIds = Array.from(productMap.keys());
    const productInfo = await fetchProducts(productIds);
    const productCategory = new Map<number, string>();
    for (const p of productInfo as any[]) {
      productCategory.set(p.id, p.categ_id ? String(p.categ_id[1]) : 'Uncategorized');
    }
    const catMap = new Map<string, number>();
    for (const [pid, prod] of productMap.entries()) {
      const cat = productCategory.get(pid) || 'Uncategorized';
      catMap.set(cat, (catMap.get(cat) || 0) + prod.revenue);
    }
    const colors = ['var(--red)', 'var(--amber)', 'var(--cyan)', 'var(--purple)', 'var(--accent)', 'var(--green)', 'var(--text-muted)'];
    const categories: CategoryMix[] = Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, rev], i) => ({
        category: cat,
        revenue: rev,
        pct: totalRev ? (rev / totalRev) * 100 : 0,
        color: colors[i % colors.length],
      }));
    categoryMix.push({ location: loc, categories });
  }

  return {
    period: { start, end },
    drinkFoodRatios,
    topSellers,
    categoryMix,
  };
}

// ═══════════════════════════════════════════════════════
// LOCATION COMPARISON
// ═══════════════════════════════════════════════════════

export async function computeLocationComparison(year: number, month: number): Promise<LocationComparisonData> {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const locations = getActiveLocations();

  const locData = await Promise.all(locations.map(async loc => {
    const [orders, payments] = await Promise.all([
      fetchOrders(loc.companyId, start, end),
      fetchPayments(loc.companyId, start, end),
    ]);
    const rev = sumAmount(orders as any);
    const tips = sumTips(orders as any);
    let cash = 0, card = 0;
    for (const p of payments as any[]) {
      const m = p.payment_method_id ? String(p.payment_method_id[1]).toLowerCase() : '';
      if (m.includes('cash') || m.includes('bar')) cash += p.amount;
      else card += p.amount;
    }
    const totalPay = cash + card;
    const days = new Set((orders as any[]).map(o => utcToBerlinDate(o.date_order))).size || 1;
    return {
      location: loc,
      rev, tips,
      orders: orders.length,
      avgTicket: orders.length ? rev / orders.length : 0,
      cashPct: totalPay ? (cash / totalPay) * 100 : 0,
      cardPct: totalPay ? (card / totalPay) * 100 : 0,
      days,
      dailyAvg: rev / days,
    };
  }));

  const metrics: LocationMetric[] = [
    { section: 'Revenue', label: 'Total Revenue',
      values: locData.map(d => ({ locationId: d.location.id, value: formatEur(d.rev) })),
      combined: formatEur(locData.reduce((a, d) => a + d.rev, 0)),
    },
    { section: 'Revenue', label: 'Daily Average',
      values: locData.map(d => ({ locationId: d.location.id, value: formatEur(d.dailyAvg) })),
    },
    { section: 'Revenue', label: 'Orders',
      values: locData.map(d => ({ locationId: d.location.id, value: formatNum(d.orders) })),
      combined: formatNum(locData.reduce((a, d) => a + d.orders, 0)),
    },
    { section: 'Revenue', label: 'Avg Ticket',
      values: locData.map(d => ({ locationId: d.location.id, value: formatEur(d.avgTicket) })),
    },
    { section: 'Concept', label: 'Type',
      values: locData.map(d => ({
        locationId: d.location.id,
        value: d.location.type === 'counter' ? 'Counter / Fast-casual' : 'Sit-down KBBQ',
      })),
    },
    { section: 'Tips', label: 'Tip Revenue',
      values: locData.map(d => ({
        locationId: d.location.id,
        value: `${formatEur(d.tips)} (${formatPct(d.rev ? (d.tips / d.rev) * 100 : 0)})`,
      })),
    },
    { section: 'Payments', label: 'Cash %',
      values: locData.map(d => ({ locationId: d.location.id, value: formatPct(d.cashPct) })),
    },
    { section: 'Payments', label: 'Card %',
      values: locData.map(d => ({ locationId: d.location.id, value: formatPct(d.cardPct) })),
    },
  ];

  return {
    period: { start, end },
    locations,
    metrics,
  };
}

// ═══════════════════════════════════════════════════════
// OWNER REPORT
// ═══════════════════════════════════════════════════════

export async function computeOwnerReport(year: number, month: number): Promise<OwnerReportData> {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const locations = getActiveLocations();

  const locData = await Promise.all(locations.map(async loc => {
    const [orders, sessions] = await Promise.all([
      fetchOrders(loc.companyId, start, end),
      fetchSessions(loc.id, 20),
    ]);
    return {
      location: loc,
      orders,
      revenue: sumAmount(orders as any),
      sessions,
    };
  }));

  const totalRevenue = locData.reduce((a, d) => a + d.revenue, 0);
  const totalOrders = locData.reduce((a, d) => a + d.orders.length, 0);
  const estimatedNetProfit = totalRevenue * 0.10;

  const byDay = new Map<string, number>();
  for (const d of locData) {
    for (const o of d.orders as any[]) {
      const day = utcToBerlinDate(o.date_order);
      byDay.set(day, (byDay.get(day) || 0) + o.amount_total);
    }
  }
  const dayEntries = Array.from(byDay.entries()).sort((a, b) => b[1] - a[1]);
  const bestDay = dayEntries[0] || ['', 0];
  const worstDay = dayEntries[dayEntries.length - 1] || ['', 0];
  const avgDaily = byDay.size ? totalRevenue / byDay.size : 0;
  const worstPctBelow = avgDaily ? ((avgDaily - worstDay[1]) / avgDaily) * 100 : 0;

  const alerts: AlertItem[] = [];
  for (const d of locData) {
    const zeroDiffSessions = (d.sessions as any[]).filter(s => s.cash_register_difference === 0).length;
    if (d.location.type === 'counter' && d.sessions.length >= 10 && zeroDiffSessions === d.sessions.length) {
      alerts.push({
        severity: 'high',
        message: `${d.location.name}: All cash sessions show €0.00 difference — staff likely not counting cash at close`,
      });
    }
    const largeDiffs = (d.sessions as any[]).filter(s => Math.abs(s.cash_register_difference) > 5).length;
    if (largeDiffs > 5) {
      alerts.push({
        severity: 'med',
        message: `${d.location.name}: ${largeDiffs} of ${d.sessions.length} sessions have cash variance >€5`,
      });
    }
  }

  const healthScores: HealthScore[] = locData.map(d => {
    const checks: HealthScore['checks'] = [];
    checks.push({ label: 'Revenue', status: d.revenue > 20000 ? 'pass' : 'warn', detail: formatEur(d.revenue) });

    const zeroSessionsAll = d.sessions.length > 0 && (d.sessions as any[]).every(s => s.cash_register_difference === 0);
    const largeDiffs = (d.sessions as any[]).filter(s => Math.abs(s.cash_register_difference) > 5).length;
    checks.push({
      label: 'Cash Control',
      status: zeroSessionsAll ? 'fail' : largeDiffs > 3 ? 'warn' : 'pass',
      detail: zeroSessionsAll ? 'Not counting' : largeDiffs > 0 ? `${largeDiffs} variances` : 'OK',
    });

    const tips = sumTips(d.orders as any);
    const tipRatio = d.revenue ? (tips / d.revenue) * 100 : 0;
    if (d.location.type === 'sitdown') {
      checks.push({
        label: 'Tip Ratio',
        status: tipRatio > 5 ? 'pass' : 'warn',
        detail: formatPct(tipRatio),
      });
    }

    return { location: d.location, checks };
  });

  const narrative = `Month revenue of ${formatEur(totalRevenue)} across ${totalOrders} orders. Estimated net profit ${formatEur(estimatedNetProfit)} (10% margin estimate). ${alerts.length} alerts open.`;

  return {
    period: { start, end },
    totalRevenue,
    estimatedNetProfit,
    totalOrders,
    revenueByLocation: locData.map(d => ({ location: d.location, revenue: d.revenue })),
    narrative,
    alerts,
    bestDay: { date: bestDay[0], revenue: bestDay[1] },
    worstDay: { date: worstDay[0], revenue: worstDay[1], pctBelowAvg: worstPctBelow },
    healthScores,
  };
}

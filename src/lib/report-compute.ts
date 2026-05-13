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

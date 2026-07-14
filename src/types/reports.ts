/**
 * Krawings Report Builder — Type Definitions
 * 
 * All data shapes returned by the report API endpoints.
 * Source: pos.order, pos.order.line, pos.payment, pos.session,
 *         account.move.line, restaurant.table via OdooClient JSON-RPC
 */

// ── COMMON ──────────────────────────────────────────────

export interface DateRange {
  start: string; // ISO date YYYY-MM-DD
  end: string;   // ISO date YYYY-MM-DD
}

export interface PeriodComparison {
  current: DateRange;
  previous: DateRange;
  label: string;
}

export type LocationId = number | 'all';

export interface LocationInfo {
  id: number;
  name: string;
  companyId: number;
  companyName: string;
  type: 'counter' | 'sitdown';
  active: boolean;
}

// ── KPI & DASHBOARD ─────────────────────────────────────

export interface KpiValue {
  value: number;
  formatted: string;
  previousValue?: number;
  previousFormatted?: string;
  changePercent?: number;
  changePp?: number;
  trend: 'up' | 'down' | 'flat';
}

export interface DashboardData {
  period: DateRange;
  location: LocationInfo;
  todayRevenue: KpiValue;
  todayOrders: KpiValue;
  avgTicket: KpiValue;
  cashCardSplit: { cashPct: number; cardPct: number; cashAmount: number; cardAmount: number };
  thisWeek: KpiValue;
  thisMonth: KpiValue;
  ytd: KpiValue;
  dailyAverage: KpiValue;
  lastMonth: {
    revenue: KpiValue;
    orders: KpiValue;
    avgTicket: KpiValue;
    vsLastYear: KpiValue;
    dailyAvg: KpiValue;
    bestDay: { date: string; revenue: number; orders: number };
  };
}

// ── DAILY BREAKDOWN ─────────────────────────────────────

export interface DailyRow {
  date: string;
  dayOfWeek: string;
  isWeekend: boolean;
  orders: number;
  revenue: number;
  avgTicket: number;
  yoyChangePercent?: number;
  isBestDay: boolean;
}

export interface DailyBreakdownData {
  period: DateRange;
  location: LocationInfo;
  days: DailyRow[];
  totals: {
    orders: number;
    revenue: number;
    avgTicket: number;
    yoyChangePercent?: number;
  };
}

// ── PERIOD COMPARISON ───────────────────────────────────

export interface ComparisonPeriod {
  label: string;
  range: DateRange;
  revenue: number;
  orders: number;
  avgTicket: number;
}

export interface DayComparison {
  day: string;
  current: number;
  previous: number;
  changePercent: number;
}

export interface ComparisonData {
  current: ComparisonPeriod;
  previous: ComparisonPeriod;
  dayByDay: DayComparison[];
  revenueChange: KpiValue;
  orderVolumeChange: KpiValue;
  avgTicketChange: KpiValue;
}

// ── RECORDS & AVERAGES ──────────────────────────────────

export interface RecordEntry {
  label: string;
  detail: string;
  value: number;
  formatted: string;
}

export interface RecordsData {
  location: LocationInfo;
  bestDays: RecordEntry[];
  bestWeeks: RecordEntry[];
  bestMonths: RecordEntry[];
  averages: {
    dailyAvgMonth: number;
    dailyAvgYtd: number;
    weeklyAvgMonth: number;
    avgTicketMonth: number;
    avgOrdersPerDayMonth: number;
  };
}

// ── P&L ─────────────────────────────────────────────────

export interface PnlLineItem {
  label: string;
  accountCodes?: string;
  currentAmount: number;
  previousAmount: number;
  changePercent: number;
  indent: number;
  isSubtotal: boolean;
  isGrandTotal: boolean;
}

export interface PnlRatio {
  id: string;
  label: string;
  value: number;
  previousValue: number;
  target?: number;
  targetLabel?: string;
  changePp: number;
  status: 'good' | 'warn' | 'bad';
  breakdown?: { label: string; value: number; color: string }[];
  infoText: string;
  formula: string;
  benchmarks?: { label: string; color: string }[];
}

export interface PnlData {
  period: DateRange;
  comparisonPeriod: DateRange;
  location: LocationInfo;
  ratios: PnlRatio[];
  lineItems: PnlLineItem[];
  revenue: { food: number; drinks: number; tips: number; total: number };
  cogs: { foodBev: number; packaging: number; total: number };
  opex: {
    wages: number;
    social: number;
    rent: number;
    utilities: number;
    insurance: number;
    other: number;
    total: number;
  };
  grossProfit: number;
  netProfit: number;
}

// ── OPERATIONS ──────────────────────────────────────────

export interface PaymentMethodSplit {
  location: LocationInfo;
  cash: { count: number; amount: number; pct: number };
  card: { count: number; amount: number; pct: number };
}

export interface HourlyBucket {
  hour: number;
  orders: number;
  revenue: number;
  isPeak: boolean;
}

export interface CashierPerformance {
  employeeId: number;
  name: string;
  orders: number;
  revenue: number;
  avgTicket: number;
  sharePct: number;
  refunds: number;
  refundAmount: number;
  refundRate: number;
  cashTipRatio: number;
  cardTipRatio: number;
  tipGapPp: number;
  flagged: boolean;
  flagReason?: string;
}

export interface OrderComposition {
  bucket: string;
  count: number;
  pct: number;
}

export interface TablePerformance {
  tableId: number;
  tableName: string;
  orders: number;
  revenue: number;
  avgCheck: number;
  tips: number;
  tipPct: number;
}

export interface TipByEmployee {
  name: string;
  orders: number;
  revenue: number;
  tips: number;
  tipSalesRatio: number;
  tipRate: number;
  avgTip: number;
  cashTipRatio: number;
  cardTipRatio: number;
  tipGapPp: number;
  cashZeroTipPct: number;
  cardZeroTipPct: number;
  flagged: boolean;
}

export interface TipByDayOfWeek {
  day: string;
  orders: number;
  revenue: number;
  tips: number;
  tipSalesRatio: number;
}

export interface TipMonthlyTrend {
  month: string;
  revenue: number;
  tips: number;
  tipSalesRatio: number;
  tipRate: number;
  changePp: number;
}

export interface DailyTipVolatility {
  name: string;
  daysWorked: number;
  meanRatio: number;
  stdev: number;
  cv: number;
  rangeMin: number;
  rangeMax: number;
  below1Sigma: number;
  below2Sigma: number;
  mostConsistent: boolean;
}

export interface RevPASH {
  totalSeats: number;
  totalTables: number;
  daysOpen: number;
  hoursPerDay: number;
  availableSeatHours: number;
  revenueExclTips: number;
  revpash: number;
  revenuePerTable: number;
  tableTurnsPerDay: number;
}

export interface SessionCashDiff {
  sessionName: string;
  date: string;
  orderCount: number;
  cashDifference: number;
  flagged: boolean;
}

export interface OperationsData {
  period: DateRange;
  paymentSplits: PaymentMethodSplit[];
  hourlyDistribution: HourlyBucket[];
  cashierPerformance: CashierPerformance[];
  orderComposition: OrderComposition[];
  tablePerformance: TablePerformance[];
  tipHeadline: {
    tipSalesRatio: KpiValue;
    totalTips: KpiValue;
    tipRate: KpiValue;
    avgTipWhenTipped: KpiValue;
  };
  tipByEmployee: TipByEmployee[];
  tipByDow: TipByDayOfWeek[];
  tipTrend: TipMonthlyTrend[];
  tipVolatility: DailyTipVolatility[];
  revpash?: RevPASH;
  sessionCashDiffs: SessionCashDiff[];
  benfordDigits?: { digit: number; observed: number; expected: number; deviation: number; flagged: boolean }[];
  sequenceGaps: { found: number; rangeStart: number; rangeEnd: number; totalOrders: number };
}

// ── MENU INTELLIGENCE ───────────────────────────────────

export interface ProductSales {
  rank: number;
  productId: number;
  name: string;
  qty: number;
  revenue: number;
  mixPct: number;
  cumulativePct: number;
}

export interface CategoryMix {
  category: string;
  revenue: number;
  pct: number;
  color: string;
}

export interface DrinkFoodRatio {
  location: LocationInfo;
  foodRevenue: number;
  foodPct: number;
  drinkRevenue: number;
  drinkPct: number;
  tipRevenue: number;
  tipPct: number;
  ratio: string;
}

export interface MenuData {
  period: DateRange;
  drinkFoodRatios: DrinkFoodRatio[];
  topSellers: { location: LocationInfo; products: ProductSales[]; uniqueProducts: number }[];
  categoryMix: { location: LocationInfo; categories: CategoryMix[] }[];
}

// ── LOCATION COMPARISON ─────────────────────────────────

export interface LocationMetric {
  label: string;
  section: string;
  values: { locationId: number; value: string; highlight?: 'good' | 'bad' | 'warn' }[];
  combined?: string;
}

export interface LocationComparisonData {
  period: DateRange;
  locations: LocationInfo[];
  metrics: LocationMetric[];
}

// ── OWNER REPORT ────────────────────────────────────────

export interface AlertItem {
  severity: 'high' | 'med' | 'info';
  message: string;
}

export interface HealthScore {
  location: LocationInfo;
  checks: { label: string; status: 'pass' | 'fail' | 'warn'; detail: string }[];
}

export interface OwnerReportData {
  period: DateRange;
  totalRevenue: number;
  estimatedNetProfit: number;
  totalOrders: number;
  revenueByLocation: { location: LocationInfo; revenue: number }[];
  narrative: string;
  alerts: AlertItem[];
  bestDay: { date: string; revenue: number };
  worstDay: { date: string; revenue: number; pctBelowAvg: number };
  healthScores: HealthScore[];
}

// ── API RESPONSE WRAPPER ────────────────────────────────

export interface ReportApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
  computedAt?: string;
}

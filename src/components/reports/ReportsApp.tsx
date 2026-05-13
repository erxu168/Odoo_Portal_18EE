'use client';

/**
 * Krawings Report Builder — Main App Shell
 * 
 * Single-file implementation with tab navigation across 9 screens.
 * Talks to /api/reports/* endpoints. Mobile-first, follows portal design system.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

// ═══════════════════════════════════════════════════════
// CONSTANTS & TYPES
// ═══════════════════════════════════════════════════════

const LOCATIONS = [
  { id: 7, name: 'Gogi Boss M38', short: 'Gogi', type: 'counter' as const },
  { id: 8, name: 'Ssam Korean BBQ', short: 'Ssam', type: 'sitdown' as const },
];

type TabId = 'dashboard' | 'daily' | 'compare' | 'records' | 'pnl' | 'operations' | 'menu' | 'locations' | 'summary';

interface Tab {
  id: TabId;
  label: string;
  short: string;
  minRole: 'manager' | 'admin';
  perLocation: boolean;
  perMonth: boolean;
  perDate?: boolean;
}

const TABS: Tab[] = [
  { id: 'dashboard',   label: 'Dashboard',     short: 'Today',     minRole: 'manager', perLocation: true,  perMonth: false, perDate: true },
  { id: 'daily',       label: 'Daily',         short: 'Daily',     minRole: 'manager', perLocation: true,  perMonth: true },
  { id: 'compare',     label: 'Compare',       short: 'Compare',   minRole: 'manager', perLocation: true,  perMonth: false, perDate: true },
  { id: 'records',     label: 'Records',       short: 'Records',   minRole: 'manager', perLocation: true,  perMonth: false, perDate: true },
  { id: 'operations',  label: 'Operations',    short: 'Ops',       minRole: 'manager', perLocation: true,  perMonth: true },
  { id: 'menu',        label: 'Menu',          short: 'Menu',      minRole: 'manager', perLocation: false, perMonth: true },
  { id: 'locations',   label: 'Locations',     short: 'Sites',     minRole: 'manager', perLocation: false, perMonth: true },
  { id: 'pnl',         label: 'P&L',           short: 'P&L',       minRole: 'admin',   perLocation: true,  perMonth: true },
  { id: 'summary',     label: 'Owner Report',  short: 'Owner',     minRole: 'admin',   perLocation: false, perMonth: true },
];

interface KpiValue {
  value: number;
  formatted: string;
  trend?: 'up' | 'down' | 'flat';
  previousValue?: number;
  previousFormatted?: string;
  changePercent?: number;
}

// ═══════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

function berlinThisMonth(): string {
  return berlinToday().slice(0, 7);
}

function lastMonthStr(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function formatEur(v: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(v);
}

function formatPct(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)}%`;
}

// ═══════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════

function LoadingBox({ message }: { message?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col items-center justify-center gap-3">
      <div className="w-8 h-8 border-3 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      <div className="text-sm text-gray-500">{message || 'Loading data from Odoo...'}</div>
      <div className="text-xs text-gray-400">First load can take 5-10 seconds</div>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
      <div className="text-sm font-bold text-red-800">Failed to load</div>
      <div className="text-xs text-red-700 mt-1 break-words">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg active:scale-95">
          Retry
        </button>
      )}
    </div>
  );
}

function ComingSoon({ title, apiUrl }: { title: string; apiUrl: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="text-base font-bold text-gray-900 mb-2">{title}</div>
      <div className="text-sm text-gray-500 mb-4">UI coming soon. Data is already available via the API:</div>
      <code className="block bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 break-all">
        GET {apiUrl}
      </code>
      <div className="text-xs text-gray-400 mt-3">
        Open this URL in a new tab (you must be logged in) to see the raw JSON response.
      </div>
    </div>
  );
}

function KpiTile({
  label,
  kpi,
  accent = 'gray',
}: {
  label: string;
  kpi: KpiValue | undefined;
  accent?: 'gray' | 'blue' | 'green' | 'orange' | 'red';
}) {
  if (!kpi) return null;
  const accentText = {
    gray: 'text-gray-900',
    blue: 'text-blue-700',
    green: 'text-green-700',
    orange: 'text-orange-700',
    red: 'text-red-700',
  }[accent];
  const trendColor =
    kpi.trend === 'up' ? 'text-green-600' :
    kpi.trend === 'down' ? 'text-red-600' :
    'text-gray-400';
  const trendArrow =
    kpi.trend === 'up' ? '\u2191' :
    kpi.trend === 'down' ? '\u2193' :
    '\u2014';
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-1 ${accentText} tabular-nums`}>{kpi.formatted}</div>
      {kpi.changePercent !== undefined && (
        <div className={`text-[11px] font-semibold mt-1 ${trendColor} tabular-nums`}>
          {trendArrow} {Math.abs(kpi.changePercent).toFixed(1)}%
          {kpi.previousFormatted && (
            <span className="text-gray-400 font-normal ml-1">vs {kpi.previousFormatted}</span>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold text-gray-400 tracking-widest uppercase mb-2 mt-5 first:mt-0">
      {children}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm p-4 ${className}`}>
      {children}
    </div>
  );
}

function LocationPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
      {LOCATIONS.map(loc => (
        <button
          key={loc.id}
          onClick={() => onChange(loc.id)}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            value === loc.id
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500'
          }`}
        >
          {loc.short}
        </button>
      ))}
    </div>
  );
}

function MonthPicker({
  value,
  onChange,
}: {
  value: string; // YYYY-MM
  onChange: (m: string) => void;
}) {
  function shift(delta: number) {
    const [y, m] = value.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const [y, m] = value.split('-').map(Number);
  const date = new Date(y, m - 1, 1);
  const label = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      <button onClick={() => shift(-1)} className="w-7 h-7 rounded-md flex items-center justify-center text-gray-600 active:bg-gray-200">
        &lsaquo;
      </button>
      <div className="flex-1 text-center text-xs font-semibold text-gray-900">{label}</div>
      <button onClick={() => shift(1)} className="w-7 h-7 rounded-md flex items-center justify-center text-gray-600 active:bg-gray-200">
        &rsaquo;
      </button>
    </div>
  );
}

function ProgressBar({ pct, color = 'blue' }: { pct: number; color?: string }) {
  const bgClass = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    cyan: 'bg-cyan-500',
  }[color] || 'bg-blue-500';
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div className={`h-full ${bgClass} transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// API HOOK
// ═══════════════════════════════════════════════════════

function useReportData<T>(url: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(url)
      .then(async r => {
        const j = await r.json();
        if (!j.success) throw new Error(j.error || `HTTP ${r.status}`);
        setData(j.data);
      })
      .catch(e => setError(e.message || 'Unknown error'))
      .finally(() => setLoading(false));
  }, [url, reloadKey]);

  const refetch = useCallback(() => setReloadKey(k => k + 1), []);
  return { data, loading, error, refetch };
}

// ═══════════════════════════════════════════════════════
// SCREEN: DASHBOARD
// ═══════════════════════════════════════════════════════

function DashboardScreen({ locationId, today }: { locationId: number; today: string }) {
  const url = `/api/reports/dashboard?location=${locationId}&today=${today}`;
  const { data, loading, error, refetch } = useReportData<any>(url);

  if (loading) return <LoadingBox />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div>
      <SectionLabel>Today</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <KpiTile label="Revenue" kpi={data.todayRevenue} accent="blue" />
        <KpiTile label="Orders" kpi={data.todayOrders} accent="gray" />
        <KpiTile label="Avg Ticket" kpi={data.avgTicket} accent="gray" />
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Cash / Card</div>
          <div className="flex h-2 mt-2 rounded-full overflow-hidden bg-gray-100">
            <div className="bg-green-500" style={{ width: `${data.cashCardSplit.cashPct}%` }} />
            <div className="bg-blue-500" style={{ width: `${data.cashCardSplit.cardPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] mt-1 tabular-nums">
            <span className="text-green-700 font-semibold">{formatPct(data.cashCardSplit.cashPct, 0)} cash</span>
            <span className="text-blue-700 font-semibold">{formatPct(data.cashCardSplit.cardPct, 0)} card</span>
          </div>
        </div>
      </div>

      <SectionLabel>This Period</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <KpiTile label="This Week" kpi={data.thisWeek} accent="gray" />
        <KpiTile label="This Month" kpi={data.thisMonth} accent="gray" />
        <KpiTile label="Year to Date" kpi={data.ytd} accent="gray" />
        <KpiTile label="Daily Avg (Month)" kpi={data.dailyAverage} accent="gray" />
      </div>

      <SectionLabel>Last Month Recap</SectionLabel>
      <Card>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Revenue</div>
            <div className="text-lg font-bold tabular-nums">{data.lastMonth.revenue.formatted}</div>
            {data.lastMonth.revenue.changePercent !== undefined && (
              <div className={`text-[11px] font-semibold ${data.lastMonth.revenue.trend === 'up' ? 'text-green-600' : data.lastMonth.revenue.trend === 'down' ? 'text-red-600' : 'text-gray-500'}`}>
                {data.lastMonth.revenue.changePercent > 0 ? '+' : ''}{data.lastMonth.revenue.changePercent.toFixed(1)}% YoY
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Orders</div>
            <div className="text-lg font-bold tabular-nums">{data.lastMonth.orders.formatted}</div>
            {data.lastMonth.orders.changePercent !== undefined && (
              <div className={`text-[11px] font-semibold ${data.lastMonth.orders.trend === 'up' ? 'text-green-600' : data.lastMonth.orders.trend === 'down' ? 'text-red-600' : 'text-gray-500'}`}>
                {data.lastMonth.orders.changePercent > 0 ? '+' : ''}{data.lastMonth.orders.changePercent.toFixed(1)}% YoY
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Avg Ticket</div>
            <div className="text-lg font-bold tabular-nums">{data.lastMonth.avgTicket.formatted}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Daily Avg</div>
            <div className="text-lg font-bold tabular-nums">{data.lastMonth.dailyAvg.formatted}</div>
          </div>
        </div>
        {data.lastMonth.bestDay?.date && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Best Day Last Month</div>
            <div className="flex items-baseline gap-2 mt-1">
              <div className="text-base font-bold tabular-nums">{formatEur(data.lastMonth.bestDay.revenue)}</div>
              <div className="text-xs text-gray-500">{data.lastMonth.bestDay.date} \u00b7 {data.lastMonth.bestDay.orders} orders</div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN: OPERATIONS (the killer screen)
// ═══════════════════════════════════════════════════════

function OperationsScreen({ locationId, month }: { locationId: number; month: string }) {
  const url = `/api/reports/operations?location=${locationId}&month=${month}`;
  const { data, loading, error, refetch } = useReportData<any>(url);

  if (loading) return <LoadingBox message="Computing operations stats..." />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;
  if (!data) return null;

  const split = data.paymentSplits?.[0];
  const hasFlaggedTips = data.tipByEmployee?.some((e: any) => e.flagged);
  const hasFlaggedSessions = data.sessionCashDiffs?.some((s: any) => s.flagged);

  return (
    <div>
      {/* Tip headline */}
      <SectionLabel>Tips</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <KpiTile label="Tip / Sales" kpi={data.tipHeadline?.tipSalesRatio} accent="green" />
        <KpiTile label="Total Tips" kpi={data.tipHeadline?.totalTips} accent="green" />
        <KpiTile label="Tip Rate" kpi={data.tipHeadline?.tipRate} accent="gray" />
        <KpiTile label="Avg When Tipped" kpi={data.tipHeadline?.avgTipWhenTipped} accent="gray" />
      </div>

      {/* Tip by employee */}
      {data.tipByEmployee && data.tipByEmployee.length > 0 && (
        <>
          <SectionLabel>
            By Employee {hasFlaggedTips && <span className="text-red-600 normal-case ml-2">\u26A0\uFE0F flagged</span>}
          </SectionLabel>
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">Server</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Tips</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Cash %</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Card %</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tipByEmployee.slice(0, 15).map((emp: any, i: number) => (
                    <tr key={i} className={`border-b border-gray-100 ${emp.flagged ? 'bg-red-50' : ''}`}>
                      <td className="p-2 font-medium text-gray-900">
                        {emp.name}
                        {emp.flagged && <span className="ml-1 text-red-600">\u26A0\uFE0F</span>}
                      </td>
                      <td className="p-2 text-right tabular-nums">{formatEur(emp.tips)}</td>
                      <td className="p-2 text-right tabular-nums">{emp.cashTipRatio.toFixed(1)}%</td>
                      <td className="p-2 text-right tabular-nums">{emp.cardTipRatio.toFixed(1)}%</td>
                      <td className={`p-2 text-right tabular-nums font-semibold ${Math.abs(emp.tipGapPp) > 3 ? 'text-red-600' : 'text-gray-500'}`}>
                        {emp.tipGapPp > 0 ? '+' : ''}{emp.tipGapPp.toFixed(1)}pp
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hasFlaggedTips && (
              <div className="p-3 bg-red-50 border-t border-red-100 text-xs text-red-800">
                <strong>Why flagged:</strong> Card tip ratio is more than 3pp higher than cash. This pattern can suggest cash tip pocketing. Investigate with camera footage or pre-/post-shift cash counts.
              </div>
            )}
          </Card>
        </>
      )}

      {/* Payment split */}
      {split && (
        <>
          <SectionLabel>Payment Mix</SectionLabel>
          <Card>
            <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
              <div className="bg-green-500" style={{ width: `${split.cash.pct}%` }} />
              <div className="bg-blue-500" style={{ width: `${split.card.pct}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <div className="text-[10px] uppercase text-green-700 font-bold tracking-wide">Cash</div>
                <div className="text-lg font-bold tabular-nums">{formatEur(split.cash.amount)}</div>
                <div className="text-[11px] text-gray-500 tabular-nums">{split.cash.count} payments \u00b7 {formatPct(split.cash.pct)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-blue-700 font-bold tracking-wide">Card</div>
                <div className="text-lg font-bold tabular-nums">{formatEur(split.card.amount)}</div>
                <div className="text-[11px] text-gray-500 tabular-nums">{split.card.count} payments \u00b7 {formatPct(split.card.pct)}</div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Hourly distribution */}
      {data.hourlyDistribution && data.hourlyDistribution.length > 0 && (
        <>
          <SectionLabel>Hourly Distribution</SectionLabel>
          <Card>
            {(() => {
              const maxOrders = Math.max(...data.hourlyDistribution.map((h: any) => h.orders));
              return (
                <div className="space-y-1.5">
                  {data.hourlyDistribution.map((h: any) => (
                    <div key={h.hour} className="flex items-center gap-2 text-xs">
                      <div className="w-10 text-gray-500 tabular-nums">{String(h.hour).padStart(2, '0')}:00</div>
                      <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${h.isPeak ? 'bg-orange-500' : 'bg-blue-400'}`}
                          style={{ width: `${(h.orders / maxOrders) * 100}%` }}
                        />
                      </div>
                      <div className="w-14 text-right text-gray-700 tabular-nums">{h.orders}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>
        </>
      )}

      {/* Cashier performance */}
      {data.cashierPerformance && data.cashierPerformance.length > 0 && (
        <>
          <SectionLabel>Cashier Leaderboard</SectionLabel>
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">Cashier</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Orders</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Revenue</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Share</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Refunds</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cashierPerformance.slice(0, 10).map((c: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="p-2 font-medium text-gray-900">{c.name}</td>
                      <td className="p-2 text-right tabular-nums">{c.orders}</td>
                      <td className="p-2 text-right tabular-nums">{formatEur(c.revenue)}</td>
                      <td className="p-2 text-right tabular-nums text-gray-500">{c.sharePct.toFixed(1)}%</td>
                      <td className={`p-2 text-right tabular-nums ${c.refunds > 5 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                        {c.refunds}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Cash session diffs */}
      {data.sessionCashDiffs && data.sessionCashDiffs.length > 0 && (
        <>
          <SectionLabel>
            Cash Sessions (last 30)
            {hasFlaggedSessions && <span className="text-red-600 normal-case ml-2">\u26A0\uFE0F &gt;\u20AC5 variance</span>}
          </SectionLabel>
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600">Date</th>
                    <th className="text-left p-2 font-semibold text-gray-600">Session</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Orders</th>
                    <th className="text-right p-2 font-semibold text-gray-600">Cash Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessionCashDiffs.map((s: any, i: number) => (
                    <tr key={i} className={`border-b border-gray-100 ${s.flagged ? 'bg-amber-50' : ''}`}>
                      <td className="p-2 text-gray-700 tabular-nums">{s.date}</td>
                      <td className="p-2 text-gray-700">{s.sessionName}</td>
                      <td className="p-2 text-right tabular-nums">{s.orderCount}</td>
                      <td className={`p-2 text-right tabular-nums font-semibold ${
                        s.cashDifference === 0 ? 'text-gray-400' :
                        Math.abs(s.cashDifference) > 5 ? 'text-red-600' :
                        s.cashDifference > 0 ? 'text-green-600' : 'text-amber-600'
                      }`}>
                        {s.cashDifference > 0 ? '+' : ''}{formatEur(s.cashDifference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* RevPASH (sit-down only) */}
      {data.revpash && (
        <>
          <SectionLabel>RevPASH (Revenue per Available Seat-Hour)</SectionLabel>
          <Card>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase text-gray-500 font-semibold">RevPASH</div>
                <div className="text-2xl font-bold text-green-700 tabular-nums">{formatEur(data.revpash.revpash)}</div>
                <div className="text-[11px] text-gray-400">per seat-hour</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-gray-500 font-semibold">Table Turns / Day</div>
                <div className="text-2xl font-bold tabular-nums">{data.revpash.tableTurnsPerDay.toFixed(2)}</div>
                <div className="text-[11px] text-gray-400">{data.revpash.totalTables} tables \u00b7 {data.revpash.totalSeats} seats</div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Sequence gaps */}
      {data.sequenceGaps && (
        <>
          <SectionLabel>Order Sequence Check</SectionLabel>
          <Card>
            <div className="flex items-baseline gap-3">
              <div className="text-2xl font-bold tabular-nums">
                {data.sequenceGaps.found === 0 ? (
                  <span className="text-green-600">\u2713 0</span>
                ) : (
                  <span className="text-red-600">{data.sequenceGaps.found}</span>
                )}
              </div>
              <div className="text-xs text-gray-500">
                gaps in {data.sequenceGaps.totalOrders} order numbers
              </div>
            </div>
            {data.sequenceGaps.found === 0 && (
              <div className="text-xs text-green-700 mt-2">
                All order numbers accounted for. No deleted/voided orders that bypass tracking.
              </div>
            )}
            {data.sequenceGaps.found > 0 && (
              <div className="text-xs text-red-700 mt-2">
                Some orders are missing from the sequence. These were likely deleted before being saved. Worth investigating.
              </div>
            )}
          </Card>
        </>
      )}

      {/* Benford's Law */}
      {data.benfordDigits && data.benfordDigits.length > 0 && (
        <>
          <SectionLabel>Benford's Law (cash transactions)</SectionLabel>
          <Card>
            <div className="text-[11px] text-gray-500 mb-3">
              First-digit distribution should match Benford expectation. Large deviations can indicate fabricated numbers.
              Note: restaurants often deviate due to menu pricing patterns.
            </div>
            <div className="space-y-1.5">
              {data.benfordDigits.map((d: any) => (
                <div key={d.digit} className="flex items-center gap-2 text-xs">
                  <div className="w-4 font-bold text-gray-700">{d.digit}</div>
                  <div className="flex-1 relative bg-gray-100 rounded-full h-4">
                    <div className="absolute top-0 left-0 h-full bg-blue-400 rounded-full" style={{ width: `${(d.observed / 35) * 100}%` }} />
                    <div className="absolute top-0 h-full w-0.5 bg-gray-700" style={{ left: `${(d.expected / 35) * 100}%` }} />
                  </div>
                  <div className="w-12 text-right tabular-nums text-gray-700">{d.observed.toFixed(1)}%</div>
                  <div className={`w-14 text-right tabular-nums font-semibold ${d.flagged ? 'text-red-600' : 'text-gray-400'}`}>
                    {d.deviation > 0 ? '+' : ''}{d.deviation.toFixed(1)}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-gray-400 mt-3">Black line = Benford expectation \u00b7 Blue bar = observed</div>
          </Card>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN: LOCATIONS COMPARISON
// ═══════════════════════════════════════════════════════

function LocationsScreen({ month }: { month: string }) {
  const url = `/api/reports/locations?month=${month}`;
  const { data, loading, error, refetch } = useReportData<any>(url);

  if (loading) return <LoadingBox />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;
  if (!data) return null;

  const sections: Record<string, any[]> = {};
  data.metrics?.forEach((m: any) => {
    if (!sections[m.section]) sections[m.section] = [];
    sections[m.section].push(m);
  });

  return (
    <div>
      {Object.entries(sections).map(([section, metrics]) => (
        <div key={section}>
          <SectionLabel>{section}</SectionLabel>
          <Card className="!p-0 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left p-2 font-semibold text-gray-600">Metric</th>
                  {data.locations.map((loc: any) => (
                    <th key={loc.id} className="text-right p-2 font-semibold text-gray-600">{loc.name.split(' ')[0]}</th>
                  ))}
                  {metrics.some((m: any) => m.combined) && (
                    <th className="text-right p-2 font-semibold text-gray-600">Total</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {metrics.map((m: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="p-2 font-medium text-gray-900">{m.label}</td>
                    {data.locations.map((loc: any) => {
                      const val = m.values.find((v: any) => v.locationId === loc.id);
                      return (
                        <td key={loc.id} className="p-2 text-right tabular-nums">{val?.value || '\u2014'}</td>
                      );
                    })}
                    {metrics.some((mm: any) => mm.combined) && (
                      <td className="p-2 text-right tabular-nums font-semibold">{m.combined || '\u2014'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN: OWNER SUMMARY
// ═══════════════════════════════════════════════════════

function SummaryScreen({ month }: { month: string }) {
  const url = `/api/reports/summary?month=${month}`;
  const { data, loading, error, refetch } = useReportData<any>(url);

  if (loading) return <LoadingBox message="Compiling owner report..." />;
  if (error) return <ErrorBox message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div>
      <SectionLabel>This Month</SectionLabel>
      <Card>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Total Revenue</div>
            <div className="text-2xl font-bold text-blue-700 tabular-nums">{formatEur(data.totalRevenue)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Est. Net Profit</div>
            <div className="text-2xl font-bold text-green-700 tabular-nums">{formatEur(data.estimatedNetProfit)}</div>
            <div className="text-[10px] text-gray-400">10% estimate</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Total Orders</div>
            <div className="text-lg font-bold tabular-nums">{data.totalOrders.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wide">Best Day</div>
            <div className="text-lg font-bold tabular-nums">{formatEur(data.bestDay?.revenue || 0)}</div>
            <div className="text-[10px] text-gray-400">{data.bestDay?.date}</div>
          </div>
        </div>
        {data.narrative && (
          <div className="mt-4 pt-3 border-t border-gray-100 text-sm text-gray-700 leading-relaxed">
            {data.narrative}
          </div>
        )}
      </Card>

      {data.alerts && data.alerts.length > 0 && (
        <>
          <SectionLabel>Alerts ({data.alerts.length})</SectionLabel>
          <div className="space-y-2">
            {data.alerts.map((a: any, i: number) => (
              <div
                key={i}
                className={`rounded-xl border p-3 ${
                  a.severity === 'high' ? 'bg-red-50 border-red-200' :
                  a.severity === 'med' ? 'bg-amber-50 border-amber-200' :
                  'bg-blue-50 border-blue-200'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`text-base ${
                    a.severity === 'high' ? 'text-red-600' :
                    a.severity === 'med' ? 'text-amber-600' :
                    'text-blue-600'
                  }`}>
                    {a.severity === 'high' ? '\u26A0\uFE0F' : a.severity === 'med' ? '\u26A1' : '\u2139\uFE0F'}
                  </div>
                  <div className={`text-xs flex-1 ${
                    a.severity === 'high' ? 'text-red-900' :
                    a.severity === 'med' ? 'text-amber-900' :
                    'text-blue-900'
                  }`}>{a.message}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {data.revenueByLocation && data.revenueByLocation.length > 0 && (
        <>
          <SectionLabel>Revenue by Location</SectionLabel>
          <Card>
            {data.revenueByLocation.map((r: any, i: number) => {
              const pct = data.totalRevenue ? (r.revenue / data.totalRevenue) * 100 : 0;
              return (
                <div key={i} className={i > 0 ? 'mt-3 pt-3 border-t border-gray-100' : ''}>
                  <div className="flex justify-between items-baseline mb-1">
                    <div className="text-sm font-semibold">{r.location.name}</div>
                    <div className="text-sm font-bold tabular-nums">{formatEur(r.revenue)}</div>
                  </div>
                  <ProgressBar pct={pct} color={r.location.type === 'counter' ? 'orange' : 'cyan'} />
                  <div className="text-[11px] text-gray-500 mt-1 tabular-nums">{formatPct(pct, 1)} of total</div>
                </div>
              );
            })}
          </Card>
        </>
      )}

      {data.healthScores && data.healthScores.length > 0 && (
        <>
          <SectionLabel>Health Scorecards</SectionLabel>
          {data.healthScores.map((hs: any, i: number) => (
            <Card key={i} className="mb-2">
              <div className="text-sm font-bold mb-2">{hs.location.name}</div>
              <div className="space-y-1.5">
                {hs.checks.map((c: any, j: number) => (
                  <div key={j} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className={
                        c.status === 'pass' ? 'text-green-600' :
                        c.status === 'warn' ? 'text-amber-600' :
                        'text-red-600'
                      }>
                        {c.status === 'pass' ? '\u2713' : c.status === 'warn' ? '\u26A0' : '\u2717'}
                      </span>
                      <span className="text-gray-700">{c.label}</span>
                    </div>
                    <div className={`tabular-nums font-semibold ${
                      c.status === 'pass' ? 'text-green-700' :
                      c.status === 'warn' ? 'text-amber-700' :
                      'text-red-700'
                    }`}>{c.detail}</div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN APP SHELL
// ═══════════════════════════════════════════════════════

export default function ReportsApp() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<string>('staff');
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [locationId, setLocationId] = useState<number>(7);
  const [month, setMonth] = useState<string>(lastMonthStr());
  const today = berlinToday();

  // Auth check
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user) {
        setUserRole(d.user.role);
        if (d.user.role !== 'manager' && d.user.role !== 'admin') {
          router.replace('/');
          return;
        }
      } else {
        router.replace('/login');
        return;
      }
      setAuthChecked(true);
    }).catch(() => {
      router.replace('/login');
    });
  }, [router]);

  const visibleTabs = useMemo(() => {
    return TABS.filter(t => {
      if (t.minRole === 'admin') return userRole === 'admin';
      return userRole === 'manager' || userRole === 'admin';
    });
  }, [userRole]);

  const currentTab = TABS.find(t => t.id === activeTab) || TABS[0];

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-12 pb-4 rounded-b-[28px] relative">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => router.push('/')} className="text-white/80 active:scale-95 transition-transform">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h1 className="text-xl font-bold text-white">Reports</h1>
        </div>
        {/* Pickers */}
        <div className="flex gap-2">
          {currentTab.perLocation && (
            <div className="flex-1">
              <LocationPicker value={locationId} onChange={setLocationId} />
            </div>
          )}
          {currentTab.perMonth && (
            <div className="flex-1">
              <MonthPicker value={month} onChange={setMonth} />
            </div>
          )}
          {currentTab.perDate && !currentTab.perMonth && (
            <div className="flex-1 bg-gray-100 rounded-lg p-1 text-center text-xs font-semibold text-gray-700">
              Today \u00b7 {today}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="overflow-x-auto">
          <div className="flex gap-1 px-3 py-2 min-w-max">
            {visibleTabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === t.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t.short}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-4">
        {activeTab === 'dashboard' && <DashboardScreen locationId={locationId} today={today} />}
        {activeTab === 'operations' && <OperationsScreen locationId={locationId} month={month} />}
        {activeTab === 'locations' && <LocationsScreen month={month} />}
        {activeTab === 'summary' && <SummaryScreen month={month} />}

        {activeTab === 'daily' && (
          <ComingSoon
            title="Daily Breakdown"
            apiUrl={`/api/reports/daily?location=${locationId}&month=${month}`}
          />
        )}
        {activeTab === 'compare' && (
          <ComingSoon
            title="Period Comparison"
            apiUrl={`/api/reports/compare?location=${locationId}&type=week&date=${today}`}
          />
        )}
        {activeTab === 'records' && (
          <ComingSoon
            title="Records & Averages"
            apiUrl={`/api/reports/records?location=${locationId}&date=${today}`}
          />
        )}
        {activeTab === 'menu' && (
          <ComingSoon
            title="Menu Intelligence"
            apiUrl={`/api/reports/menu?month=${month}`}
          />
        )}
        {activeTab === 'pnl' && (
          <ComingSoon
            title="Profit & Loss"
            apiUrl={`/api/reports/pnl?location=${locationId}&month=${month}`}
          />
        )}
      </div>
    </div>
  );
}

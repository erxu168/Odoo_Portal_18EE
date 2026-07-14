'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import {
  LocationPicker, KpiTile, SectionTitle, LoadingState, ErrorState,
  useReport, fmtEur, fmtNum, fmtPct,
} from '@/components/reports/shared';
import type { DashboardData } from '@/types/reports';

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

export default function DashboardReportPage() {
  const router = useRouter();
  const [locationId, setLocationId] = useState(7);
  const [today] = useState(berlinToday());
  const url = `/api/reports/dashboard?location=${locationId}&today=${today}`;
  const { data, loading, error } = useReport<DashboardData>(url);

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <AppHeader supertitle="REPORT" title="Dashboard" subtitle={`Today: ${today}`} showBack onBack={() => router.push('/reports')} />
      <LocationPicker locationId={locationId} onChange={setLocationId} />

      {loading && <LoadingState message="Loading dashboard\u2026 (3-8s on first load)" />}
      {error && <ErrorState error={error} />}

      {data && (
        <div className="px-5">
          <SectionTitle subtitle="Live revenue today vs same weekday last week">Today</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Revenue" kpi={data.todayRevenue} size="lg" changeSuffix="vs last wk" />
            <KpiTile label="Orders" kpi={data.todayOrders} size="lg" changeSuffix="vs last wk" />
            <KpiTile label="Avg Ticket" kpi={data.avgTicket} changeSuffix="vs last wk" />
            <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
              <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Payment Mix</div>
              <div className="font-mono text-[16px] font-bold text-gray-900">
                {fmtPct(data.cashCardSplit.cashPct, 0)} cash
              </div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-1">
                {fmtEur(data.cashCardSplit.cashAmount)} cash<br/>{fmtEur(data.cashCardSplit.cardAmount)} card
              </div>
            </div>
          </div>

          <SectionTitle subtitle="Current periods vs prior comparable">This week / month / year</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="This Week" kpi={data.thisWeek} changeSuffix="vs last wk" />
            <KpiTile label="This Month" kpi={data.thisMonth} changeSuffix="vs last yr" />
            <KpiTile label="YTD" kpi={data.ytd} changeSuffix="vs last yr" />
            <KpiTile label="Daily Avg (MTD)" kpi={data.dailyAverage} changeSuffix="vs last mo" />
          </div>

          <SectionTitle subtitle="Closed period recap">Last Month</SectionTitle>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-gray-200">
              <div className="p-4 border-b border-gray-200">
                <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Revenue</div>
                <div className="font-mono text-[20px] font-bold text-gray-900">{data.lastMonth.revenue.formatted}</div>
                {data.lastMonth.revenue.changePercent !== undefined && (
                  <div className={`text-[var(--fs-xs)] font-mono font-semibold mt-1 ${data.lastMonth.revenue.trend === 'up' ? 'text-green-600' : data.lastMonth.revenue.trend === 'down' ? 'text-red-600' : 'text-gray-500'}`}>
                    {data.lastMonth.revenue.trend === 'up' ? '\u2191' : data.lastMonth.revenue.trend === 'down' ? '\u2193' : '\u2192'} {Math.abs(data.lastMonth.revenue.changePercent).toFixed(1)}% vs last yr
                  </div>
                )}
              </div>
              <div className="p-4 border-b border-gray-200">
                <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Orders</div>
                <div className="font-mono text-[20px] font-bold text-gray-900">{fmtNum(data.lastMonth.orders.value)}</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mt-1">avg {data.lastMonth.avgTicket.formatted}</div>
              </div>
              <div className="p-4">
                <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Daily Avg</div>
                <div className="font-mono text-[20px] font-bold text-gray-900">{data.lastMonth.dailyAvg.formatted}</div>
              </div>
              <div className="p-4">
                <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Best Day</div>
                <div className="font-mono text-[16px] font-bold text-gray-900">{fmtEur(data.lastMonth.bestDay.revenue)}</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mt-1">{data.lastMonth.bestDay.date || '\u2014'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

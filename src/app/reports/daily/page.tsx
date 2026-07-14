'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import {
  LocationPicker, MonthPicker, KpiTile, SectionTitle, LoadingState, ErrorState,
  useReport, fmtEur, fmtNum,
} from '@/components/reports/shared';
import type { DailyBreakdownData, KpiValue } from '@/types/reports';

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

export default function DailyReportPage() {
  const router = useRouter();
  const [locationId, setLocationId] = useState(7);
  const [month, setMonth] = useState(berlinToday().substring(0, 7));
  const url = `/api/reports/daily?location=${locationId}&month=${month}`;
  const { data, loading, error } = useReport<DailyBreakdownData>(url);

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <AppHeader supertitle="REPORT" title="Daily Breakdown" subtitle={month} showBack onBack={() => router.push('/reports')} />
      <LocationPicker locationId={locationId} onChange={setLocationId} />

      <div className="px-5 py-3 bg-white border-b border-gray-200 flex items-center gap-2">
        <span className="text-[var(--fs-xs)] text-gray-500 font-semibold">Month:</span>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {loading && <LoadingState message="Loading daily breakdown\u2026" />}
      {error && <ErrorState error={error} />}

      {data && (
        <div className="px-5">
          <SectionTitle subtitle="Month total + comparison to same month last year">Month Totals</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile
              label="Revenue"
              kpi={{
                value: data.totals.revenue,
                formatted: fmtEur(data.totals.revenue),
                trend: data.totals.yoyChangePercent === undefined ? 'flat' : data.totals.yoyChangePercent > 0 ? 'up' : 'down',
                changePercent: data.totals.yoyChangePercent,
              } as KpiValue}
              size="lg"
              changeSuffix="vs last yr"
            />
            <KpiTile
              label="Orders"
              kpi={{ value: data.totals.orders, formatted: fmtNum(data.totals.orders), trend: 'flat' }}
              size="lg"
            />
          </div>

          <SectionTitle subtitle={`${data.days.length} days. Best day highlighted in green.`}>Day-by-day</SectionTitle>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 text-[10px] font-bold text-gray-400 tracking-wider uppercase px-3 py-2 bg-gray-50 border-b border-gray-200">
              <div className="col-span-3">Date</div>
              <div className="col-span-2 text-right">Orders</div>
              <div className="col-span-3 text-right">Revenue</div>
              <div className="col-span-2 text-right">Avg</div>
              <div className="col-span-2 text-right">YoY</div>
            </div>
            {data.days.map((d, i) => (
              <div
                key={d.date}
                className={`grid grid-cols-12 text-[var(--fs-sm)] px-3 py-2.5 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${d.isBestDay ? 'bg-green-50' : ''} ${d.isWeekend ? 'text-gray-900' : 'text-gray-700'}`}
              >
                <div className="col-span-3">
                  <div className="font-mono font-semibold text-[12px]">{d.date.substring(5)}</div>
                  <div className="text-[10px] text-gray-500">{d.dayOfWeek}{d.isWeekend ? ' \u00b7 weekend' : ''}{d.isBestDay ? ' \u00b7 best' : ''}</div>
                </div>
                <div className="col-span-2 text-right font-mono">{fmtNum(d.orders)}</div>
                <div className="col-span-3 text-right font-mono font-semibold">{fmtEur(d.revenue)}</div>
                <div className="col-span-2 text-right font-mono text-gray-500">{fmtEur(d.avgTicket).replace(',00', '')}</div>
                <div className={`col-span-2 text-right font-mono font-semibold ${d.yoyChangePercent === undefined ? 'text-gray-300' : d.yoyChangePercent > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {d.yoyChangePercent === undefined ? '\u2014' : `${d.yoyChangePercent > 0 ? '+' : ''}${d.yoyChangePercent.toFixed(0)}%`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import {
  LocationPicker, SectionTitle, LoadingState, ErrorState,
  useReport, fmtEur, fmtNum,
} from '@/components/reports/shared';
import type { RecordsData, RecordEntry } from '@/types/reports';

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

function RecordList({ entries }: { entries: RecordEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-center py-6 text-gray-400 text-[var(--fs-sm)]">No data</div>;
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {entries.map((entry, i) => (
        <div key={i} className={`flex items-center px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center mr-3 flex-shrink-0 font-bold text-[14px] ${i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
            {i + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[var(--fs-sm)] font-bold text-gray-900 leading-tight">{entry.label}</div>
            <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{entry.detail}</div>
          </div>
          <div className="font-mono font-bold text-gray-900">{entry.formatted}</div>
        </div>
      ))}
    </div>
  );
}

export default function RecordsReportPage() {
  const router = useRouter();
  const [locationId, setLocationId] = useState(7);
  const [date] = useState(berlinToday());
  const url = `/api/reports/records?location=${locationId}&date=${date}`;
  const { data, loading, error } = useReport<RecordsData>(url);

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <AppHeader supertitle="REPORT" title="Records & Averages" subtitle={`YTD as of ${date}`} showBack onBack={() => router.push('/reports')} />
      <LocationPicker locationId={locationId} onChange={setLocationId} />

      {loading && <LoadingState />}
      {error && <ErrorState error={error} />}

      {data && (
        <div className="px-5">
          <SectionTitle subtitle="Top revenue days year-to-date">Best Days</SectionTitle>
          <RecordList entries={data.bestDays} />

          <SectionTitle subtitle="Top revenue weeks year-to-date">Best Weeks</SectionTitle>
          <RecordList entries={data.bestWeeks} />

          <SectionTitle subtitle="Top revenue months this year">Best Months</SectionTitle>
          <RecordList entries={data.bestMonths} />

          <SectionTitle subtitle="Operating tempo">Averages</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
              <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Daily Avg (MTD)</div>
              <div className="font-mono text-[20px] font-bold text-gray-900">{fmtEur(data.averages.dailyAvgMonth)}</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
              <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Daily Avg (YTD)</div>
              <div className="font-mono text-[20px] font-bold text-gray-900">{fmtEur(data.averages.dailyAvgYtd)}</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
              <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Weekly Avg (MTD)</div>
              <div className="font-mono text-[20px] font-bold text-gray-900">{fmtEur(data.averages.weeklyAvgMonth)}</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
              <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Avg Ticket (MTD)</div>
              <div className="font-mono text-[20px] font-bold text-gray-900">{fmtEur(data.averages.avgTicketMonth)}</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm col-span-2">
              <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">Avg Orders / Day (MTD)</div>
              <div className="font-mono text-[20px] font-bold text-gray-900">{fmtNum(Math.round(data.averages.avgOrdersPerDayMonth))}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import {
  LocationPicker, KpiTile, SectionTitle, LoadingState, ErrorState,
  useReport, fmtEur, fmtNum,
} from '@/components/reports/shared';
import type { ComparisonData } from '@/types/reports';

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

type CompareType = 'week' | 'month' | 'quarter' | 'year';

export default function CompareReportPage() {
  const router = useRouter();
  const [locationId, setLocationId] = useState(7);
  const [type, setType] = useState<CompareType>('month');
  const [date] = useState(berlinToday());
  const url = `/api/reports/compare?location=${locationId}&type=${type}&date=${date}`;
  const { data, loading, error } = useReport<ComparisonData>(url);

  const TYPES: { id: CompareType; label: string }[] = [
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
    { id: 'quarter', label: 'Quarter' },
    { id: 'year', label: 'Year' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <AppHeader supertitle="REPORT" title="Period Compare" subtitle="Current vs prior comparable" showBack onBack={() => router.push('/reports')} />
      <LocationPicker locationId={locationId} onChange={setLocationId} />

      <div className="flex gap-2 px-5 py-3 bg-white border-b border-gray-200 overflow-x-auto">
        {TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={`px-3 py-1.5 rounded-lg text-[var(--fs-sm)] font-semibold whitespace-nowrap ${
              type === t.id ? 'bg-[#2563EB] text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState error={error} />}

      {data && (
        <div className="px-5">
          <SectionTitle subtitle="Headline changes">Changes</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Revenue" kpi={data.revenueChange} size="lg" changeSuffix="" />
            <KpiTile label="Orders" kpi={data.orderVolumeChange} size="lg" changeSuffix="" />
            <KpiTile label="Avg Ticket" kpi={data.avgTicketChange} changeSuffix="" />
          </div>

          <SectionTitle subtitle="Side-by-side">Periods</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
              <div className="text-[10px] font-bold text-blue-600 tracking-widest uppercase mb-2">{data.current.label}</div>
              <div className="text-[10px] text-gray-400 mb-3">{data.current.range.start} \u2192 {data.current.range.end}</div>
              <div className="space-y-2">
                <div><div className="text-[10px] text-gray-400 uppercase tracking-wide">Revenue</div><div className="font-mono font-bold">{fmtEur(data.current.revenue)}</div></div>
                <div><div className="text-[10px] text-gray-400 uppercase tracking-wide">Orders</div><div className="font-mono font-bold">{fmtNum(data.current.orders)}</div></div>
                <div><div className="text-[10px] text-gray-400 uppercase tracking-wide">Avg Ticket</div><div className="font-mono font-bold">{fmtEur(data.current.avgTicket)}</div></div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
              <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-2">{data.previous.label}</div>
              <div className="text-[10px] text-gray-400 mb-3">{data.previous.range.start} \u2192 {data.previous.range.end}</div>
              <div className="space-y-2">
                <div><div className="text-[10px] text-gray-400 uppercase tracking-wide">Revenue</div><div className="font-mono font-bold text-gray-500">{fmtEur(data.previous.revenue)}</div></div>
                <div><div className="text-[10px] text-gray-400 uppercase tracking-wide">Orders</div><div className="font-mono font-bold text-gray-500">{fmtNum(data.previous.orders)}</div></div>
                <div><div className="text-[10px] text-gray-400 uppercase tracking-wide">Avg Ticket</div><div className="font-mono font-bold text-gray-500">{fmtEur(data.previous.avgTicket)}</div></div>
              </div>
            </div>
          </div>

          {data.dayByDay.length > 0 && (
            <>
              <SectionTitle subtitle="Same weekday vs prior week">Day by Day</SectionTitle>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {data.dayByDay.map((d, i) => (
                  <div key={d.day} className={`grid grid-cols-12 text-[var(--fs-sm)] px-3 py-2.5 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className="col-span-2 font-semibold text-gray-700">{d.day}</div>
                    <div className="col-span-4 text-right font-mono">{fmtEur(d.current)}</div>
                    <div className="col-span-4 text-right font-mono text-gray-500">{fmtEur(d.previous)}</div>
                    <div className={`col-span-2 text-right font-mono font-semibold ${d.previous === 0 ? 'text-gray-300' : d.changePercent > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {d.previous === 0 ? '\u2014' : `${d.changePercent > 0 ? '+' : ''}${d.changePercent.toFixed(0)}%`}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import {
  LocationPicker, MonthPicker, SectionTitle, LoadingState, ErrorState, InfoTooltip,
  useReport, fmtEur, fmtPct,
} from '@/components/reports/shared';
import type { PnlData, PnlRatio, PnlLineItem } from '@/types/reports';

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

function formatRatioValue(r: PnlRatio): string {
  if (r.id === 'monthly_breakeven' || r.id === 'daily_breakeven' || r.id === 'controllable_profit') {
    return fmtEur(r.value);
  }
  if (r.id === 'rev_per_labor') {
    return `${r.value.toFixed(2)}\u00d7`;
  }
  return fmtPct(r.value);
}

function RatioTile({ r }: { r: PnlRatio }) {
  const statusBg = r.status === 'good' ? 'bg-green-50 border-green-200' :
                   r.status === 'warn' ? 'bg-amber-50 border-amber-200' :
                   'bg-red-50 border-red-200';
  const statusText = r.status === 'good' ? 'text-green-700' :
                     r.status === 'warn' ? 'text-amber-700' :
                     'text-red-700';
  const changeText = r.changePp === 0 ? 'text-gray-400' :
                     r.changePp > 0 ? (r.id === 'gross_margin' || r.id === 'net_margin' || r.id === 'rev_per_labor' || r.id === 'controllable_profit' || r.id === 'controllable_margin' ? 'text-green-600' : 'text-red-600') :
                     (r.id === 'gross_margin' || r.id === 'net_margin' || r.id === 'rev_per_labor' || r.id === 'controllable_profit' || r.id === 'controllable_margin' ? 'text-red-600' : 'text-green-600');

  return (
    <div className={`rounded-xl p-3 border shadow-sm ${statusBg}`}>
      <div className="flex items-start justify-between mb-1">
        <div className="text-[10px] font-bold text-gray-600 tracking-wide uppercase leading-tight">{r.label}</div>
        <InfoTooltip text={r.infoText} formula={r.formula} benchmarks={r.benchmarks} />
      </div>
      <div className={`font-mono text-[20px] font-bold ${statusText}`}>{formatRatioValue(r)}</div>
      {r.targetLabel && (
        <div className="text-[10px] text-gray-500 font-mono mt-0.5">target {r.targetLabel}</div>
      )}
      {r.changePp !== 0 && (
        <div className={`text-[10px] font-mono font-semibold mt-1 ${changeText}`}>
          {r.changePp > 0 ? '+' : ''}{r.changePp.toFixed(1)}pp vs prev
        </div>
      )}
    </div>
  );
}

function PnlRow({ item }: { item: PnlLineItem }) {
  const pad = item.indent === 1 ? 'pl-6' : item.indent === 2 ? 'pl-9' : 'pl-3';
  const weight = item.isGrandTotal ? 'font-bold' : item.isSubtotal ? 'font-semibold' : 'font-normal';
  const bg = item.isGrandTotal ? 'bg-gray-900 text-white' : item.isSubtotal ? 'bg-gray-100' : 'bg-white';
  const text = item.isGrandTotal ? 'text-white' : 'text-gray-900';
  const valueClass = item.currentAmount < 0 ? 'text-red-600' : item.currentAmount > 0 ? text : 'text-gray-400';
  return (
    <div className={`grid grid-cols-12 px-3 py-2 ${bg} ${item.isGrandTotal ? '' : 'border-t border-gray-100'} ${weight}`}>
      <div className={`col-span-6 text-[var(--fs-sm)] ${pad} ${item.isGrandTotal ? 'text-white' : text}`}>{item.label}</div>
      <div className={`col-span-3 text-right font-mono text-[var(--fs-sm)] ${item.isGrandTotal ? 'text-white' : valueClass}`}>
        {fmtEur(item.currentAmount)}
      </div>
      <div className={`col-span-3 text-right font-mono text-[var(--fs-xs)] ${item.isGrandTotal ? 'text-white/70' : 'text-gray-400'}`}>
        {fmtEur(item.previousAmount)}
      </div>
    </div>
  );
}

export default function PnlReportPage() {
  const router = useRouter();
  const [locationId, setLocationId] = useState(7);
  const [month, setMonth] = useState(berlinToday().substring(0, 7));
  const url = `/api/reports/pnl?location=${locationId}&month=${month}`;
  const { data, loading, error } = useReport<PnlData>(url);

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <AppHeader supertitle="REPORT \u00b7 ADMIN" title="P&L" subtitle={month} showBack onBack={() => router.push('/reports')} />
      <LocationPicker locationId={locationId} onChange={setLocationId} />

      <div className="px-5 py-3 bg-white border-b border-gray-200 flex items-center gap-2">
        <span className="text-[var(--fs-xs)] text-gray-500 font-semibold">Month:</span>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {loading && <LoadingState message="Loading P&L\u2026 (slow first time)" />}
      {error && <ErrorState error={error} />}

      {data && (
        <div className="px-5">
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[var(--fs-xs)] text-amber-900">
            <strong>Heads up:</strong> COGS uses real account.move.line data. If vendor bills aren&rsquo;t posted yet, COGS will read low and net margin will appear inflated.
          </div>

          <SectionTitle subtitle="12 ratios with targets & status. Tap ? for definition.">Health Ratios</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {data.ratios.map(r => <RatioTile key={r.id} r={r} />)}
          </div>

          <SectionTitle subtitle="Revenue, COGS, OpEx, Net Profit. Current vs prior year.">Full Statement</SectionTitle>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 text-[10px] font-bold text-gray-400 tracking-wider uppercase px-3 py-2 bg-gray-50 border-b border-gray-200">
              <div className="col-span-6">Line</div>
              <div className="col-span-3 text-right">Current</div>
              <div className="col-span-3 text-right">Prior Yr</div>
            </div>
            {data.lineItems.map((it, i) => <PnlRow key={i} item={it} />)}
          </div>

          <SectionTitle subtitle="Where revenue comes from">Revenue Mix</SectionTitle>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-[var(--fs-sm)] text-gray-700">Food (7% USt)</span>
                <span className="font-mono font-semibold">{fmtEur(data.revenue.food)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--fs-sm)] text-gray-700">Drinks (19% USt)</span>
                <span className="font-mono font-semibold">{fmtEur(data.revenue.drinks)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--fs-sm)] text-gray-700">Tips</span>
                <span className="font-mono font-semibold">{fmtEur(data.revenue.tips)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-200">
                <span className="text-[var(--fs-sm)] font-bold text-gray-900">Total</span>
                <span className="font-mono font-bold text-gray-900">{fmtEur(data.revenue.total)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

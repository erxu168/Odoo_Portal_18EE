'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import {
  LocationPicker, MonthPicker, KpiTile, SectionTitle, LoadingState, ErrorState,
  useReport, fmtEur, fmtNum, fmtPct,
} from '@/components/reports/shared';
import type { OperationsData, CashierPerformance, TipByEmployee, HourlyBucket } from '@/types/reports';

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

function HourlyHeatmap({ data }: { data: HourlyBucket[] }) {
  if (data.length === 0) return <div className="text-gray-400 text-[var(--fs-sm)] py-4 text-center">No data</div>;
  const max = Math.max(...data.map(d => d.orders));
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3">
      <div className="space-y-1">
        {data.map(h => (
          <div key={h.hour} className="flex items-center gap-2">
            <div className="w-10 text-[11px] font-mono text-gray-500">{String(h.hour).padStart(2, '0')}:00</div>
            <div className="flex-1 h-5 bg-gray-100 rounded relative overflow-hidden">
              <div
                className={`h-full rounded ${h.isPeak ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${(h.orders / max) * 100}%` }}
              />
            </div>
            <div className="w-16 text-right text-[11px] font-mono font-semibold">{fmtNum(h.orders)}</div>
            <div className="w-20 text-right text-[11px] font-mono text-gray-500">{fmtEur(h.revenue)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CashierRow({ c }: { c: CashierPerformance }) {
  return (
    <div className={`px-3 py-3 border-t border-gray-100 ${c.flagged ? 'bg-red-50' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold text-[var(--fs-sm)] text-gray-900">{c.name}</div>
          <div className="text-[10px] text-gray-500 font-mono mt-0.5">
            {fmtNum(c.orders)} orders \u00b7 avg {fmtEur(c.avgTicket)} \u00b7 {fmtPct(c.sharePct)} share
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono font-bold">{fmtEur(c.revenue)}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
        <div>
          <div className="text-gray-400 uppercase tracking-wider">Cash tip</div>
          <div className="font-mono font-semibold">{fmtPct(c.cashTipRatio)}</div>
        </div>
        <div>
          <div className="text-gray-400 uppercase tracking-wider">Card tip</div>
          <div className="font-mono font-semibold">{fmtPct(c.cardTipRatio)}</div>
        </div>
        <div>
          <div className="text-gray-400 uppercase tracking-wider">Gap</div>
          <div className={`font-mono font-semibold ${Math.abs(c.tipGapPp) > 3 ? 'text-red-600' : 'text-gray-700'}`}>
            {c.tipGapPp > 0 ? '+' : ''}{c.tipGapPp.toFixed(1)}pp
          </div>
        </div>
      </div>
      {c.refunds > 0 && (
        <div className="text-[10px] text-gray-500 mt-1 font-mono">
          {c.refunds} refunds \u00b7 {fmtEur(c.refundAmount)} \u00b7 {fmtPct(c.refundRate, 2)} rate
        </div>
      )}
      {c.flagged && c.flagReason && (
        <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-[10px] text-red-900">
          \u26a0 {c.flagReason}
        </div>
      )}
    </div>
  );
}

export default function OperationsReportPage() {
  const router = useRouter();
  const [locationId, setLocationId] = useState(7);
  const [month, setMonth] = useState(berlinToday().substring(0, 7));
  const url = `/api/reports/operations?location=${locationId}&month=${month}`;
  const { data, loading, error } = useReport<OperationsData>(url);

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <AppHeader supertitle="REPORT" title="Operations" subtitle={month} showBack onBack={() => router.push('/reports')} />
      <LocationPicker locationId={locationId} onChange={setLocationId} />

      <div className="px-5 py-3 bg-white border-b border-gray-200 flex items-center gap-2">
        <span className="text-[var(--fs-xs)] text-gray-500 font-semibold">Month:</span>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {loading && <LoadingState message="Loading operations\u2026 (slow first time)" />}
      {error && <ErrorState error={error} />}

      {data && (
        <div className="px-5">
          <SectionTitle subtitle="Tip ratio anomalies flagged automatically">Tip Headline</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Tip / Sales" kpi={data.tipHeadline.tipSalesRatio} size="lg" />
            <KpiTile label="Total Tips" kpi={data.tipHeadline.totalTips} size="lg" />
            <KpiTile label="Tip Rate" kpi={data.tipHeadline.tipRate} />
            <KpiTile label="Avg Tip (when tipped)" kpi={data.tipHeadline.avgTipWhenTipped} />
          </div>

          {data.paymentSplits.length > 0 && (
            <>
              <SectionTitle subtitle="Cash vs card payment mix">Payment Mix</SectionTitle>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                {data.paymentSplits.map((p, i) => (
                  <div key={i}>
                    <div className="flex h-8 rounded-lg overflow-hidden mb-2">
                      <div className="bg-amber-500 flex items-center justify-center text-white text-[11px] font-bold" style={{ width: `${p.cash.pct}%` }}>
                        {p.cash.pct >= 10 && `${p.cash.pct.toFixed(0)}%`}
                      </div>
                      <div className="bg-blue-500 flex items-center justify-center text-white text-[11px] font-bold" style={{ width: `${p.card.pct}%` }}>
                        {p.card.pct >= 10 && `${p.card.pct.toFixed(0)}%`}
                      </div>
                    </div>
                    <div className="flex justify-between text-[var(--fs-xs)]">
                      <span><span className="inline-block w-2 h-2 bg-amber-500 rounded mr-1"/> Cash {fmtEur(p.cash.amount)}</span>
                      <span><span className="inline-block w-2 h-2 bg-blue-500 rounded mr-1"/> Card {fmtEur(p.card.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.hourlyDistribution.length > 0 && (
            <>
              <SectionTitle subtitle="Orders & revenue by hour. Peak hour in red.">Hourly Distribution</SectionTitle>
              <HourlyHeatmap data={data.hourlyDistribution} />
            </>
          )}

          {data.cashierPerformance.length > 0 && (
            <>
              <SectionTitle subtitle="Per-employee revenue, tip ratios & refund rates. Flagged rows = tip-pocketing risk.">Cashier Performance</SectionTitle>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {data.cashierPerformance.map((c, i) => (
                  <div key={c.employeeId} className={i === 0 ? '' : ''}>
                    <CashierRow c={c} />
                  </div>
                ))}
              </div>
            </>
          )}

          {data.tipByEmployee.filter(t => t.flagged).length > 0 && (
            <>
              <SectionTitle subtitle="Cash-vs-card tip gap > 3pp. Investigate with camera footage.">Tip Anomalies</SectionTitle>
              <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
                {data.tipByEmployee.filter(t => t.flagged).map((t, i) => (
                  <div key={t.name} className={`px-3 py-3 ${i > 0 ? 'border-t border-gray-100' : ''} bg-red-50`}>
                    <div className="font-bold text-[var(--fs-sm)] text-gray-900">{t.name}</div>
                    <div className="text-[10px] text-gray-600 mt-1">
                      Card tips: <span className="font-mono font-semibold">{fmtPct(t.cardTipRatio)}</span> &nbsp;\u00b7&nbsp;
                      Cash tips: <span className="font-mono font-semibold">{fmtPct(t.cashTipRatio)}</span> &nbsp;\u00b7&nbsp;
                      Gap: <span className="font-mono font-semibold text-red-700">{Math.abs(t.tipGapPp).toFixed(1)}pp</span>
                    </div>
                    <div className="text-[10px] text-gray-600">
                      Zero-tip rate: cash {fmtPct(t.cashZeroTipPct)} vs card {fmtPct(t.cardZeroTipPct)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.revpash && (
            <>
              <SectionTitle subtitle="Revenue per available seat-hour (sitdown only)">RevPASH</SectionTitle>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                <div className="text-center mb-3">
                  <div className="font-mono text-[32px] font-bold text-gray-900">{fmtEur(data.revpash.revpash).replace(',00', '')}</div>
                  <div className="text-[var(--fs-xs)] text-gray-500">per seat-hour</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[var(--fs-xs)]">
                  <div>Seats: <span className="font-mono font-semibold">{data.revpash.totalSeats}</span></div>
                  <div>Tables: <span className="font-mono font-semibold">{data.revpash.totalTables}</span></div>
                  <div>Days open: <span className="font-mono font-semibold">{data.revpash.daysOpen}</span></div>
                  <div>Turns/day: <span className="font-mono font-semibold">{data.revpash.tableTurnsPerDay.toFixed(2)}</span></div>
                </div>
              </div>
            </>
          )}

          {data.sessionCashDiffs.length > 0 && (
            <>
              <SectionTitle subtitle="Cash variance per POS session. Flagged > \u00b15\u20ac.">Cash Control</SectionTitle>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {data.sessionCashDiffs.slice(0, 20).map((s, i) => (
                  <div key={i} className={`flex justify-between items-center px-3 py-2 ${i > 0 ? 'border-t border-gray-100' : ''} ${s.flagged ? 'bg-amber-50' : ''}`}>
                    <div>
                      <div className="text-[var(--fs-sm)] font-mono text-gray-700">{s.sessionName}</div>
                      <div className="text-[10px] text-gray-400">{s.date} \u00b7 {fmtNum(s.orderCount)} orders</div>
                    </div>
                    <div className={`font-mono font-bold ${s.cashDifference === 0 ? 'text-gray-400' : Math.abs(s.cashDifference) > 5 ? 'text-red-600' : 'text-amber-600'}`}>
                      {s.cashDifference >= 0 ? '+' : ''}{fmtEur(s.cashDifference)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.benfordDigits && (
            <>
              <SectionTitle subtitle="Leading-digit distribution of cash amounts. Big deviations flagged.">Benford&rsquo;s Law</SectionTitle>
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="text-[10px] text-gray-500 px-3 py-2 bg-gray-50 border-b border-gray-200">
                  Note: Restaurant pricing isn&rsquo;t naturally Benford-distributed (most items end in 0/5) so use only as a trend signal.
                </div>
                {data.benfordDigits.map(b => (
                  <div key={b.digit} className={`grid grid-cols-12 px-3 py-2 text-[var(--fs-xs)] border-t border-gray-100 ${b.flagged ? 'bg-amber-50' : ''}`}>
                    <div className="col-span-2 font-mono font-bold">Digit {b.digit}</div>
                    <div className="col-span-3 text-right font-mono">{fmtPct(b.observed)} obs</div>
                    <div className="col-span-3 text-right font-mono text-gray-500">{fmtPct(b.expected)} exp</div>
                    <div className={`col-span-4 text-right font-mono font-semibold ${b.flagged ? 'text-amber-700' : 'text-gray-500'}`}>
                      {b.deviation > 0 ? '+' : ''}{b.deviation.toFixed(1)}pp
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionTitle subtitle="Order sequence gap check">Audit</SectionTitle>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <div className="flex justify-between">
              <span className="text-[var(--fs-sm)] text-gray-700">Gaps in order sequence</span>
              <span className={`font-mono font-bold ${data.sequenceGaps.found > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {data.sequenceGaps.found}
              </span>
            </div>
            <div className="text-[10px] text-gray-400 mt-1">
              Across {fmtNum(data.sequenceGaps.totalOrders)} orders ({data.sequenceGaps.rangeStart} \u2192 {data.sequenceGaps.rangeEnd})
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

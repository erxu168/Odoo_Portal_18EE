'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { DEFAULT_COMPANY_ID } from './companies';

interface HourBucket { hour: number; forecast: number; actual: number }

interface ItemVariance {
  prep_item_id: number;
  name: string;
  station: string | null;
  unit: string;
  batch_size: number | null;
  forecast: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  byHour: HourBucket[];
}

interface UnmappedProduct {
  product_id: number;
  product_name: string;
  total_qty: number;
}

interface VarianceResponse {
  date: string;
  totals: {
    forecast: number;
    actual: number;
    variance: number;
    variancePct: number | null;
    itemsWithData: number;
    itemsTotal: number;
  };
  items: ItemVariance[];
  unmappedProducts: UnmappedProduct[];
}

function berlinDate(offsetDays = 0): string {
  const now = new Date();
  const target = new Date(now.getTime() + offsetDays * 86400000);
  return target.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

function formatDateLabel(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

function varianceBg(pct: number | null): string {
  if (pct === null) return 'bg-gray-50 border-gray-200';
  const abs = Math.abs(pct);
  if (abs < 10) return 'bg-green-50 border-green-200';
  if (abs < 25) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function varianceText(pct: number | null): string {
  if (pct === null) return 'text-gray-500';
  const abs = Math.abs(pct);
  if (abs < 10) return 'text-green-700';
  if (abs < 25) return 'text-amber-700';
  return 'text-red-700';
}

export default function PrepVariance() {
  const router = useRouter();
  const search = useSearchParams();
  const companyId = Number(search.get('companyId')) || DEFAULT_COMPANY_ID;

  const [date, setDate] = useState<string>(berlinDate(-1));
  const [data, setData] = useState<VarianceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/prep-planner/variance?companyId=${companyId}&date=${date}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        console.error('[prep-planner] variance load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [companyId, date]);

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-16">
      <AppHeader
        supertitle="PREP PLANNER"
        title="Forecast accuracy"
        subtitle={formatDateLabel(date)}
        showBack
        onBack={() => router.push('/prep-planner')}
      />

      <div className="px-4 py-4 space-y-4">
        {/* Date selector */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDate(berlinDate(-1))}
              className={`flex-1 h-10 rounded-lg text-[12px] font-semibold ${date === berlinDate(-1) ? 'bg-cyan-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDate(berlinDate(-7))}
              className={`flex-1 h-10 rounded-lg text-[12px] font-semibold ${date === berlinDate(-7) ? 'bg-cyan-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              7d ago
            </button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="h-10 px-2 rounded-lg border border-gray-200 bg-white text-[12px]"
            />
          </div>
        </div>

        {loading || !data ? (
          <div className="flex justify-center py-10">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-cyan-600 rounded-full animate-spin" />
          </div>
        ) : data.items.length === 0 ? (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <div className="text-4xl mb-2 opacity-40">{'\u{1F4C9}'}</div>
              <div className="text-[14px] font-semibold text-gray-700">No variance data for this day</div>
              <div className="text-[12px] text-gray-500 mt-1 leading-relaxed">
                Need both a forecast run and POS sales for {formatDateLabel(date)}.
              </div>
            </div>
            {data.unmappedProducts.length > 0 && (
              <UnmappedList products={data.unmappedProducts} />
            )}
          </>
        ) : (
          <>
            {/* Overall total */}
            <div className={`rounded-xl border p-4 ${varianceBg(data.totals.variancePct)}`}>
              <div className="text-[11px] font-bold tracking-wider uppercase text-gray-600">Day total</div>
              <div className="mt-1 flex items-baseline gap-3 flex-wrap">
                <div className="text-[24px] font-bold text-gray-900">
                  {Math.round(data.totals.actual)}
                </div>
                <div className="text-[12px] text-gray-500">
                  actual vs {Math.round(data.totals.forecast)} forecast
                </div>
                {data.totals.variancePct !== null && (
                  <div className={`text-[14px] font-bold ${varianceText(data.totals.variancePct)}`}>
                    {data.totals.variancePct > 0 ? '+' : ''}{data.totals.variancePct}%
                  </div>
                )}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {data.totals.itemsWithData} of {data.totals.itemsTotal} prep items have data
              </div>
            </div>

            {/* Per item */}
            <div className="space-y-2">
              {data.items.map(item => {
                const pctLabel = item.variancePct !== null
                  ? `${item.variancePct > 0 ? '+' : ''}${item.variancePct}%`
                  : item.forecast === 0 ? 'no forecast' : '';
                return (
                  <div
                    key={item.prep_item_id}
                    className={`rounded-xl border p-4 ${varianceBg(item.variancePct)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold text-gray-900 truncate">{item.name}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">{item.station || '\u2014'} \u00b7 {item.unit}</div>
                      </div>
                      <div className={`text-[14px] font-bold ${varianceText(item.variancePct)}`}>
                        {pctLabel}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                      <div>
                        <div className="text-[16px] font-bold text-gray-900">{Math.round(item.forecast)}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Forecast</div>
                      </div>
                      <div>
                        <div className="text-[16px] font-bold text-gray-900">{Math.round(item.actual)}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Actual</div>
                      </div>
                      <div>
                        <div className={`text-[16px] font-bold ${varianceText(item.variancePct)}`}>
                          {item.variance > 0 ? '+' : ''}{Math.round(item.variance)}
                        </div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{item.variance >= 0 ? 'Over' : 'Under'}</div>
                      </div>
                    </div>

                    {/* hour-by-hour bar compare */}
                    {item.byHour.length > 0 && (
                      <CompareBars rows={item.byHour} />
                    )}

                    <button
                      onClick={() => router.push(`/prep-planner/items/${item.prep_item_id}?companyId=${companyId}`)}
                      className="mt-3 text-[12px] font-semibold text-cyan-700 active:underline"
                    >
                      Open item \u2192
                    </button>
                  </div>
                );
              })}
            </div>

            {data.unmappedProducts.length > 0 && (
              <UnmappedList products={data.unmappedProducts} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CompareBars({ rows }: { rows: HourBucket[] }) {
  const peak = Math.max(1, ...rows.flatMap(r => [r.forecast, r.actual]));
  return (
    <div className="mt-3 flex items-end gap-1 h-14">
      {rows.map(r => (
        <div key={r.hour} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
          <div className="flex items-end gap-0.5 w-full flex-1">
            <div
              className="flex-1 bg-gray-400 rounded-sm"
              title={`${r.hour}h forecast ${Math.round(r.forecast)}`}
              style={{ height: `${Math.max(2, (r.forecast / peak) * 100)}%` }}
            />
            <div
              className="flex-1 bg-cyan-500 rounded-sm"
              title={`${r.hour}h actual ${Math.round(r.actual)}`}
              style={{ height: `${Math.max(2, (r.actual / peak) * 100)}%` }}
            />
          </div>
          <div className="text-[9px] text-gray-500">{r.hour}</div>
        </div>
      ))}
    </div>
  );
}

function UnmappedList({ products }: { products: UnmappedProduct[] }) {
  if (products.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Unmapped POS products</div>
        <div className="text-[11px] text-gray-500">{products.length}</div>
      </div>
      <div className="px-4 pb-2 text-[11px] text-gray-500">
        Sold on this date but not linked to any prep item.
      </div>
      <div className="divide-y divide-gray-100">
        {products.slice(0, 20).map(p => (
          <div key={p.product_id} className="px-4 py-2 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-gray-800 truncate">{p.product_name}</div>
              <div className="text-[11px] text-gray-500">POS #{p.product_id}</div>
            </div>
            <div className="text-[13px] font-bold text-gray-700">{p.total_qty}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

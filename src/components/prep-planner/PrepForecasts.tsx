'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { DEFAULT_COMPANY_ID } from './companies';

interface ForecastRow {
  id: number;
  prep_item_id: number;
  target_date: string;
  target_hour: number;
  forecast_portions: number;
  source_products_json: string;
  prep_item_name: string;
  prep_item_unit: string;
  prep_item_station: string | null;
  prep_item_batch_size: number | null;
}

interface GroupedItem {
  prep_item_id: number;
  name: string;
  station: string | null;
  unit: string;
  batchSize: number | null;
  total: number;
  byHour: { hour: number; portions: number }[];
  peakHour: number;
  peakPortions: number;
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

export default function PrepForecasts() {
  const router = useRouter();
  const search = useSearchParams();
  const companyId = Number(search.get('companyId')) || DEFAULT_COMPANY_ID;

  const [date, setDate] = useState<string>(berlinDate(1));
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/prep-planner/forecasts-by-item?companyId=${companyId}&date=${date}`);
        const data = await res.json();
        if (!cancelled) setRows(data.forecasts || []);
      } catch (err) {
        console.error('[prep-planner] forecasts load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [companyId, date]);

  const grouped = useMemo<GroupedItem[]>(() => {
    const map = new Map<number, GroupedItem>();
    for (const r of rows) {
      let g = map.get(r.prep_item_id);
      if (!g) {
        g = {
          prep_item_id: r.prep_item_id,
          name: r.prep_item_name,
          station: r.prep_item_station,
          unit: r.prep_item_unit,
          batchSize: r.prep_item_batch_size,
          total: 0,
          byHour: [],
          peakHour: 0,
          peakPortions: 0,
        };
        map.set(r.prep_item_id, g);
      }
      g.total += r.forecast_portions;
      g.byHour.push({ hour: r.target_hour, portions: r.forecast_portions });
      if (r.forecast_portions > g.peakPortions) {
        g.peakPortions = r.forecast_portions;
        g.peakHour = r.target_hour;
      }
    }
    const items = Array.from(map.values());
    for (const g of items) {
      g.byHour.sort((a, b) => a.hour - b.hour);
    }
    return items.sort((a, b) => b.total - a.total);
  }, [rows]);

  const totalPortions = grouped.reduce((s, g) => s + g.total, 0);

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-16">
      <AppHeader
        supertitle="PREP PLANNER"
        title="Forecasts"
        subtitle={formatDateLabel(date)}
        showBack
        onBack={() => router.push('/prep-planner')}
      />

      <div className="px-4 py-4 space-y-4">
        {/* Date selector */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDate(berlinDate(0))}
              className={`flex-1 h-10 rounded-lg text-[12px] font-semibold ${date === berlinDate(0) ? 'bg-cyan-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Today
            </button>
            <button
              onClick={() => setDate(berlinDate(1))}
              className={`flex-1 h-10 rounded-lg text-[12px] font-semibold ${date === berlinDate(1) ? 'bg-cyan-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Tomorrow
            </button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="h-10 px-2 rounded-lg border border-gray-200 bg-white text-[12px]"
            />
          </div>
        </div>

        {/* Total */}
        {!loading && grouped.length > 0 && (
          <div className="bg-gradient-to-br from-cyan-50 to-indigo-50 rounded-xl border border-cyan-100 p-4 text-center">
            <div className="text-[11px] font-bold tracking-wider uppercase text-cyan-700">Total forecast</div>
            <div className="text-[28px] font-bold text-gray-900 mt-1">{Math.round(totalPortions)}</div>
            <div className="text-[12px] text-gray-500">portions across {grouped.length} items</div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-cyan-600 rounded-full animate-spin" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <div className="text-4xl mb-2 opacity-40">{'\u{1F4CA}'}</div>
            <div className="text-[14px] font-semibold text-gray-700">No forecasts for this date</div>
            <div className="text-[12px] text-gray-500 mt-1">
              Create prep items, link POS products, then run the forecast.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.map(g => (
              <button
                key={g.prep_item_id}
                onClick={() => router.push(`/prep-planner/items/${g.prep_item_id}?companyId=${companyId}`)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 active:scale-[0.98] transition-transform"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold text-gray-900 truncate">{g.name}</div>
                    <div className="text-[12px] text-gray-500 mt-0.5">
                      {g.station || '\u2014'} \u00b7 peak {String(g.peakHour).padStart(2, '0')}:00
                      {g.batchSize && ` \u00b7 ${Math.ceil(g.total / g.batchSize)} batch${Math.ceil(g.total / g.batchSize) === 1 ? '' : 'es'}`}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[20px] font-bold text-gray-900 leading-none">{Math.round(g.total)}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-wider">{g.unit}</div>
                  </div>
                </div>

                {/* Hour sparkline */}
                <HourBars points={g.byHour} peak={g.peakPortions} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HourBars({ points, peak }: { points: { hour: number; portions: number }[]; peak: number }) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const byHourMap = new Map(points.map(p => [p.hour, p.portions]));
  return (
    <div className="mt-3 flex items-end gap-[2px] h-10">
      {hours.map(h => {
        const v = byHourMap.get(h) || 0;
        const pct = peak > 0 ? Math.max(4, Math.round((v / peak) * 100)) : 0;
        const isOpen = h >= 10 && h <= 22;
        return (
          <div key={h} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className={`w-full rounded-sm ${v > 0 ? 'bg-cyan-500' : isOpen ? 'bg-gray-100' : 'bg-transparent'}`}
              style={{ height: v > 0 ? `${pct}%` : isOpen ? '2px' : '0' }}
            />
          </div>
        );
      })}
    </div>
  );
}

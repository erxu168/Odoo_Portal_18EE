'use client';

import React from 'react';

interface AnalyticsPayload {
  month: string;
  prev_month: string;
  month_total: number;
  month_orders: number;
  prev_month_total: number;
  delta_abs: number;
  delta_pct: number | null;
  top_suppliers: { supplier_id: number; supplier_name: string; total: number; orders: number }[];
  top_categories: { category_name: string; total: number }[];
}

interface InsightsScreenProps {
  month: string;
  data: AnalyticsPayload | null;
  loading: boolean;
  onShiftMonth: (delta: number) => void;
  formatMonth: (ym: string) => string;
}

export default function InsightsScreen({ month, data, loading, onShiftMonth, formatMonth }: InsightsScreenProps) {
  return (
    <div className="px-4 py-3 pb-20">
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-3 py-2 mb-3">
        <button
          onClick={() => onShiftMonth(-1)}
          aria-label="Previous month"
          className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="text-[14px] font-bold text-gray-900">{formatMonth(month)}</div>
        <button
          onClick={() => onShiftMonth(1)}
          aria-label="Next month"
          className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}

      {!loading && data && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Total spend</div>
            <div className="text-[28px] font-extrabold font-mono text-gray-900">&euro;{data.month_total.toFixed(2)}</div>
            <div className="text-[12px] text-gray-500 mt-1">
              {data.month_orders} order{data.month_orders === 1 ? '' : 's'}
            </div>
            {data.prev_month_total > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-gray-500">vs {formatMonth(data.prev_month)}</div>
                  <div className="text-[12px] text-gray-400 font-mono">&euro;{data.prev_month_total.toFixed(2)}</div>
                </div>
                <div
                  className={`text-[13px] font-bold ${data.delta_abs > 0 ? 'text-red-600' : data.delta_abs < 0 ? 'text-green-600' : 'text-gray-500'}`}
                >
                  {data.delta_abs > 0 ? '\u25B2' : data.delta_abs < 0 ? '\u25BC' : '\u2014'}{' '}
                  {data.delta_pct !== null ? `${Math.abs(data.delta_pct).toFixed(1)}%` : ''}
                </div>
              </div>
            )}
            {data.prev_month_total === 0 && data.month_total > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                No spend recorded for {formatMonth(data.prev_month)}.
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-3">Top suppliers</div>
            {data.top_suppliers.length === 0 ? (
              <div className="text-[12px] text-gray-400 py-2">No orders this month.</div>
            ) : (
              (() => {
                const max = Math.max(...data.top_suppliers.map((s) => s.total)) || 1;
                return data.top_suppliers.map((s) => (
                  <div key={s.supplier_id} className="mb-2.5 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[13px] font-semibold text-gray-900 truncate flex-1 mr-2">{s.supplier_name}</div>
                      <div className="text-[12px] font-mono font-bold text-gray-900">&euro;{s.total.toFixed(2)}</div>
                    </div>
                    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-[#2563EB] rounded-full" style={{ width: `${(s.total / max) * 100}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {s.orders} order{s.orders === 1 ? '' : 's'}
                    </div>
                  </div>
                ));
              })()
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-3">Top categories</div>
            {data.top_categories.length === 0 ? (
              <div className="text-[12px] text-gray-400 py-2">No line data this month.</div>
            ) : (
              (() => {
                const max = Math.max(...data.top_categories.map((c) => c.total)) || 1;
                return data.top_categories.map((c) => (
                  <div key={c.category_name} className="mb-2.5 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[13px] font-semibold text-gray-900 truncate flex-1 mr-2">{c.category_name}</div>
                      <div className="text-[12px] font-mono font-bold text-gray-900">&euro;{c.total.toFixed(2)}</div>
                    </div>
                    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-green-500 rounded-full" style={{ width: `${(c.total / max) * 100}%` }} />
                    </div>
                  </div>
                ));
              })()
            )}
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { SearchBar, Spinner, EmptyState } from './ui';

interface ConsumptionReportProps {
  onBack: () => void;
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function thisMonth() {
  const d = new Date();
  const first = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: first, to: today };
}
function fmt(n: number) { return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString(); }

export default function ConsumptionReport({ onBack }: ConsumptionReportProps) {
  const [range, setRange] = useState(thisMonth());
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!range.from || !range.to) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/consumption?from=${range.from}&to=${range.to}`);
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to load'); setItems([]); }
      else setItems(d.items || []);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i: any) => (i.name || '').toLowerCase().includes(q));
  }, [items, search]);

  const dateInput = 'h-10 px-2.5 border border-gray-300 rounded-lg text-[var(--fs-sm)] text-gray-900 bg-white outline-none focus:border-green-500';

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Consumption</h1>
      </div>

      <div className="px-4 pb-1 flex items-start gap-2 text-[var(--fs-xs)] text-gray-500 leading-snug">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
        <span>Used per period, from your prep/recipes in Odoo. Doesn{'’'}t include cook-to-order items or waste/spoilage.</span>
      </div>

      <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
        <input type="date" value={range.from} max={range.to}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={dateInput} aria-label="From date" />
        <span className="text-[var(--fs-sm)] text-gray-400">to</span>
        <input type="date" value={range.to} min={range.from}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={dateInput} aria-label="To date" />
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search ingredient..." />

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="mx-4 mt-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)] font-semibold">{error}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No consumption" body="Nothing was used in this period, or nothing matches your search." />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-24">
          <div className="text-[var(--fs-xs)] text-gray-400 py-2">{filtered.length} ingredient{filtered.length !== 1 ? 's' : ''} used</div>
          {filtered.map((i: any) => (
            <div key={i.product_id} className="flex items-center justify-between gap-3 py-3 border-b border-gray-100">
              <div className="min-w-0 flex-1">
                <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{i.name}</div>
                {i.sales > 0 && i.prep > 0 && (
                  <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5 font-mono">prep {fmt(i.prep)} {'·'} sales {fmt(i.sales)}</div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-[var(--fs-lg)] font-mono font-bold text-gray-900">{fmt(i.total)}</span>
                <span className="text-[var(--fs-xs)] text-gray-400 font-normal ml-1">{i.uom}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

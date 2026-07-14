'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { DEFAULT_COMPANY_ID } from './companies';

interface PrepItem {
  id: number;
  company_id: number;
  name: string;
  station: string | null;
  prep_type: 'advance' | 'batch' | 'ondemand' | null;
  prep_time_min: number | null;
  max_holding_min: number | null;
  batch_size: number | null;
  unit: string;
  active: number;
  notes: string | null;
}

const PREP_TYPE_META: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  ondemand: { label: 'Start now',  dot: 'bg-red-500',    bg: 'bg-red-50',    text: 'text-red-700' },
  batch:    { label: 'Batch',      dot: 'bg-amber-500',  bg: 'bg-amber-50',  text: 'text-amber-700' },
  advance:  { label: 'Plate',      dot: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700' },
};

export default function PrepItemsList() {
  const router = useRouter();
  const search = useSearchParams();
  const companyId = Number(search.get('companyId')) || DEFAULT_COMPANY_ID;

  const [items, setItems] = useState<PrepItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/prep-planner/items?companyId=${companyId}&includeInactive=1`);
        const data = await res.json();
        if (!cancelled) setItems(data.items || []);
      } catch (err) {
        console.error('[prep-planner] items load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [companyId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(item => {
      if (!showInactive && item.active !== 1) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        (item.station || '').toLowerCase().includes(q) ||
        (item.prep_type || '').toLowerCase().includes(q)
      );
    });
  }, [items, query, showInactive]);

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-24">
      <AppHeader
        supertitle="PREP PLANNER"
        title="Prep items"
        subtitle={`${filtered.length} of ${items.length}`}
        showBack
        onBack={() => router.push('/prep-planner')}
      />

      <div className="px-4 py-4 space-y-3">
        {/* Search bar */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, station, type\u2026"
            className="w-full h-12 pl-10 pr-3 rounded-xl border border-gray-200 bg-white text-[14px]"
          />
        </div>

        {/* Inactive toggle */}
        <label className="flex items-center gap-2 text-[12px] text-gray-600 px-1">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="w-4 h-4"
          />
          Show inactive items
        </label>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-cyan-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <div className="text-4xl mb-2 opacity-40">{'\u{1F372}'}</div>
            <div className="text-[14px] font-semibold text-gray-700">
              {items.length === 0 ? 'No prep items yet' : 'No matches'}
            </div>
            <div className="text-[12px] text-gray-500 mt-1">
              {items.length === 0 ? 'Add Rice, Bulgogi, Kimchi, and the rest.' : 'Try a different search.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(item => {
              const meta = item.prep_type ? PREP_TYPE_META[item.prep_type] : null;
              return (
                <button
                  key={item.id}
                  onClick={() => router.push(`/prep-planner/items/${item.id}?companyId=${companyId}`)}
                  className={`w-full text-left bg-white rounded-xl border shadow-sm p-4 active:scale-[0.98] transition-transform ${item.active === 1 ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-[15px] font-bold text-gray-900 truncate">{item.name}</div>
                        {item.active !== 1 && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Inactive</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[12px] text-gray-500">
                        {item.station && <span>{item.station}</span>}
                        {item.prep_time_min && <span>{item.prep_time_min}m prep</span>}
                        {item.batch_size && <span>{item.batch_size} / batch</span>}
                      </div>
                    </div>
                    {meta && (
                      <div className={`px-2.5 py-1 rounded-full ${meta.bg} ${meta.text} flex items-center gap-1.5 flex-shrink-0`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        <span className="text-[11px] font-semibold">{meta.label}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Fixed add button */}
      <button
        onClick={() => router.push(`/prep-planner/items/new?companyId=${companyId}`)}
        className="fixed bottom-6 right-5 w-14 h-14 rounded-full bg-cyan-600 text-white shadow-lg shadow-cyan-600/30 flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Add prep item"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
  );
}

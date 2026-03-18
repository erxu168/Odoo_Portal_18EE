'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { Bom } from '@/types/manufacturing';

interface BomListProps {
  onSelect: (bom: Bom) => void;
  onBack?: () => void; // BUG FIX #2: Optional back handler
}

function StatusDot({ status }: { status: string }) {
  if (status === 'none') return null; // BUG FIX #6: Hide dot when no stock data
  const color =
    status === 'ok'
      ? 'bg-emerald-500'
      : status === 'low'
        ? 'bg-amber-400'
        : 'bg-red-500';
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color} mr-2 flex-shrink-0`} />
  );
}

export default function BomList({ onSelect, onBack }: BomListProps) {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  useEffect(() => { fetchBoms(); }, []);

  async function fetchBoms() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/boms');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBoms(data.boms || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load recipes');
    } finally {
      setLoading(false);
    }
  }

  const categories = useMemo(() => {
    const cats = new Set(boms.map((b) => b.category || 'Uncategorized'));
    return ['All', ...Array.from(cats).sort()];
  }, [boms]);

  const filtered = useMemo(() => {
    return boms.filter((b) => {
      const matchSearch = !search || b.product_tmpl_id[1].toLowerCase().includes(search.toLowerCase());
      const matchCategory = activeCategory === 'All' || b.category === activeCategory;
      return matchSearch && matchCategory;
    });
  }, [boms, search, activeCategory]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-emerald-600 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading recipes...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center">
          <div className="text-3xl mb-3">\u26A0\uFE0F</div>
          <p className="text-sm text-gray-700 font-medium">Connection Error</p>
          <p className="text-xs text-gray-500 mt-1 mb-4">{error}</p>
          <button onClick={fetchBoms} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header — BUG FIX #2: Show back button when onBack is provided */}
      <div className="bg-white px-5 pt-3.5 pb-3 border-b border-gray-200">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 mb-1 text-indigo-500 text-[13px] active:opacity-70">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
            Back
          </button>
        )}
        <h1 className="text-lg font-semibold text-gray-900">Recipes</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {filtered.length} active BOM{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Search */}
      <div className="mx-4 mt-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
          />
        </div>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors ${
              activeCategory === cat
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-medium'
                : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* BOM Cards */}
      <div className="px-4 pb-6 flex flex-col gap-1.5">
        {filtered.map((bom) => (
          <button
            key={bom.id}
            onClick={() => onSelect(bom)}
            className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex justify-between items-center text-left w-full active:bg-gray-50 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center">
                <StatusDot status={bom.availability_status || 'none'} />
                <span className="text-[15px] font-medium text-gray-900 truncate">
                  {bom.product_tmpl_id[1]}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5 ml-4">
                {bom.category !== 'All' ? bom.category : ''}
                {bom.category !== 'All' && bom.component_count ? ' \u00b7 ' : ''}
                {bom.component_count} component{bom.component_count !== 1 ? 's' : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
              <div className="text-right">
                <div className="text-sm font-medium text-gray-700 tabular-nums">
                  {new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(bom.product_qty)}
                  <span className="text-gray-400 font-normal ml-0.5">{bom.product_uom_id[1]}</span>
                </div>
                <div className="text-[11px] text-gray-400">per batch</div>
              </div>
              <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No recipes found</div>
        )}
      </div>
    </div>
  );
}

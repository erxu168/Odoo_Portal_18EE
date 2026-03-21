'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { Bom } from '@/types/manufacturing';
import { useCompany } from '@/lib/company-context';

interface BomListProps {
  onSelect: (bom: Bom) => void;
  onBack?: () => void;
}

export default function BomList({ onSelect, onBack }: BomListProps) {
  const { companyId } = useCompany();
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  useEffect(() => { if (companyId) fetchBoms(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchBoms() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/boms?company_id=${companyId}`);
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
    const cats = Array.from(new Set(boms.map((b) => b.category || 'Uncategorized'))).sort();
    return ['All', ...cats.filter(c => c !== 'All')];
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
        <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <p className="text-[15px] text-gray-900 font-bold mb-1">Connection error</p>
          <p className="text-[13px] text-gray-500 mb-5">{error}</p>
          <button onClick={fetchBoms} className="px-6 py-3 bg-orange-500 text-white text-sm font-bold rounded-xl">Retry</button>
          {onBack && <button onClick={onBack} className="block mx-auto mt-3 text-[13px] text-gray-500">Go back</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1A1F2E] px-5 pt-12 pb-3 relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          {onBack && (
            <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
          )}
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Recipes</h1>
            <p className="text-[12px] text-white/45 mt-0.5">{filtered.length} active recipes</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text" placeholder="Search recipes..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 bg-white text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
          />
        </div>
      </div>

      <div className="flex gap-1.5 px-4 py-3 overflow-x-auto no-scrollbar">
        {categories.map((cat) => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
              activeCategory === cat ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
            }`}>{cat}</button>
        ))}
      </div>

      <div className="px-4 pb-24 flex flex-col gap-2">
        {filtered.map((bom) => (
          <button key={bom.id} onClick={() => onSelect(bom)}
            className="bg-white border border-gray-200 rounded-xl px-4 py-3.5 flex justify-between items-center text-left w-full active:scale-[0.98] transition-transform">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-gray-900 truncate">{bom.product_tmpl_id[1]}</div>
              <div className="text-[12px] text-gray-500 mt-0.5">
                {bom.category !== 'All' ? bom.category : ''}
                {bom.category !== 'All' && bom.component_count ? ' \u00b7 ' : ''}
                {bom.component_count} ingredient{bom.component_count !== 1 ? 's' : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
              <div className="text-right">
                <div className="text-[14px] font-bold text-orange-500 tabular-nums font-mono">
                  {new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(bom.product_qty)}
                  <span className="text-gray-400 font-normal text-[12px] ml-0.5">{bom.product_uom_id[1]}</span>
                </div>
                <div className="text-[11px] text-gray-400">per batch</div>
              </div>
              <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">No recipes found</div>}
      </div>
    </div>
  );
}

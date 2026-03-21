'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';

interface PickListProps {
  onBack: () => void;
  onHome: () => void;
}

interface PickItem {
  product_id: number;
  product_name: string;
  uom: string;
  total_demand: number;
  total_picked: number;
  remaining: number;
  category: string;
  mo_names: string[];
  mo_count: number;
}

export default function PickList({ onBack, onHome }: PickListProps) {
  const { companyId } = useCompany();
  const [items, setItems] = useState<PickItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [moCount, setMoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [collected, setCollected] = useState<Set<number>>(new Set());

  useEffect(() => { if (companyId) fetchPickList(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchPickList() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders/pick-list?company_id=${companyId}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setItems(data.items || []);
      setCategories(data.categories || []);
      setMoCount(data.mo_count || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleCollected(productId: number) {
    setCollected(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  const filtered = activeCategory === 'All' ? items : items.filter(i => i.category === activeCategory);
  const groupedCategories = activeCategory === 'All' ? categories : [activeCategory];
  const collectedCount = collected.size;
  const totalCount = items.length;

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n);

  const HomeIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <div className="bg-[#1A1F2E] px-5 pt-12 pb-3 relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-white truncate">Pick list</h1>
            <p className="text-[12px] text-white/45 mt-0.5">{moCount} confirmed order{moCount !== 1 ? 's' : ''} &bull; {totalCount} components</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors" title="Home"><HomeIcon /></button>
        </div>
      </div>

      {error ? (
        <div className="px-4 py-16 text-center">
          <p className="text-[13px] text-gray-500 mb-4">{error}</p>
          <button onClick={fetchPickList} className="px-6 py-3 bg-green-600 text-white text-sm font-bold rounded-xl">Retry</button>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">&#9989;</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">No components needed</div>
          <div className="text-[13px] text-gray-500">No confirmed orders waiting for ingredients.</div>
        </div>
      ) : (
        <>
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-gray-400">{collectedCount}/{totalCount} collected</span>
              {collectedCount === totalCount && totalCount > 0 && (
                <span className="text-[11px] font-semibold text-green-600">All collected!</span>
              )}
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-300" style={{ width: `${totalCount > 0 ? (collectedCount / totalCount) * 100 : 0}%` }} />
            </div>
          </div>

          <div className="px-4 pt-2 pb-3">
            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
              <button onClick={() => setActiveCategory('All')}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-all ${
                  activeCategory === 'All' ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'
                }`}>All ({totalCount})</button>
              {categories.map(cat => {
                const count = items.filter(i => i.category === cat).length;
                return (
                  <button key={cat} onClick={() => setActiveCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-all ${
                      activeCategory === cat ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'
                    }`}>{cat} ({count})</button>
                );
              })}
            </div>
          </div>

          <div className="px-4 pb-24">
            {groupedCategories.map(cat => {
              const catItems = filtered.filter(i => i.category === cat);
              if (catItems.length === 0) return null;
              return (
                <div key={cat} className="mb-4">
                  <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2 flex justify-between">
                    <span>{cat}</span>
                    <span className="font-mono text-gray-300">{catItems.length}</span>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
                    {catItems.map(item => {
                      const isCollected = collected.has(item.product_id);
                      return (
                        <button
                          key={item.product_id}
                          onClick={() => toggleCollected(item.product_id)}
                          className={`w-full flex items-center gap-3 py-3 border-b border-gray-100 last:border-0 text-left active:bg-gray-50 transition-colors ${
                            isCollected ? 'opacity-60' : ''
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-lg border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                            isCollected ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'
                          }`}>
                            {isCollected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-[13px] font-semibold ${isCollected ? 'text-gray-400 line-through' : 'text-[#1F2933]'}`}>
                              {item.product_name}
                            </div>
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              {item.mo_count} order{item.mo_count !== 1 ? 's' : ''}: {item.mo_names.join(', ')}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className={`text-[15px] font-bold font-mono ${isCollected ? 'text-green-500' : 'text-[#1F2933]'}`}>
                              {fmt(item.remaining > 0 ? item.remaining : item.total_demand)}
                            </div>
                            <div className="text-[10px] text-gray-400">{item.uom}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

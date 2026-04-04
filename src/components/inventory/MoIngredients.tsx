'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FilterBar, FilterPill, SearchBar, Spinner, EmptyState } from './ui';

interface MoIngredientsProps {
  userRole: string;
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

export default function MoIngredients({ userRole }: MoIngredientsProps) {
  const [items, setItems] = useState<PickItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [moCount, setMoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/manufacturing-orders/pick-list');
        const data = await res.json();
        setItems(data.items || []);
        setCategories(data.categories || []);
        setMoCount(data.mo_count || 0);
      } catch (err) {
        console.error('Failed to load MO ingredients:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = [...items];
    if (search) list = list.filter((i) => i.product_name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== 'all') list = list.filter((i) => i.category === catFilter);
    return list;
  }, [items, search, catFilter]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, PickItem[]> = {};
    for (const item of filtered) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Stats bar */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-3">
        <span className="text-[var(--fs-xs)] font-semibold text-gray-500">
          {moCount} confirmed MO{moCount !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-300">&middot;</span>
        <span className="text-[var(--fs-xs)] font-semibold text-gray-500">
          {items.length} ingredient{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search ingredients..." />

      {categories.length > 1 && (
        <FilterBar>
          <FilterPill active={catFilter === 'all'} label="All" count={items.length} onClick={() => setCatFilter('all')} />
          {categories.map((cat) => (
            <FilterPill key={cat} active={catFilter === cat} label={cat}
              count={items.filter(i => i.category === cat).length}
              onClick={() => setCatFilter(cat)} />
          ))}
        </FilterBar>
      )}

      {/* Ingredient list grouped by category */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? 'No confirmed MOs' : 'No ingredients match'}
            body={items.length === 0 ? 'There are no confirmed manufacturing orders right now.' : 'Try a different search or category'}
          />
        ) : (
          grouped.map(([category, catItems]) => (
            <div key={category} className="mb-4">
              <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">
                {category} ({catItems.length})
              </p>
              {catItems.map((item) => (
                <div key={item.product_id} className="flex items-center gap-3 py-3 border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">
                      {item.product_name}
                    </div>
                    <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5 flex items-center gap-1.5">
                      <span>{item.uom}</span>
                      <span className="text-gray-300">&middot;</span>
                      <span>{item.mo_count} MO{item.mo_count !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <div className="text-[15px] font-mono font-semibold text-gray-900 tabular-nums">
                      {item.total_demand % 1 === 0 ? item.total_demand : item.total_demand.toFixed(2)}
                    </div>
                    {item.total_picked > 0 && (
                      <div className="text-[var(--fs-xs)] text-green-600 font-mono tabular-nums">
                        {item.total_picked % 1 === 0 ? item.total_picked : item.total_picked.toFixed(2)} picked
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

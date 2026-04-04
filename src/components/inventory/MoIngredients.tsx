'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FilterBar, FilterPill, SearchBar, Stepper, Spinner, EmptyState, CountProgress } from './ui';
import NumpadModal from './NumpadModal';

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
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [numpad, setNumpad] = useState<{ open: boolean; item: PickItem | null }>({ open: false, item: null });

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

  const grouped = useMemo(() => {
    const groups: Record<string, PickItem[]> = {};
    for (const item of filtered) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const countedN = Object.keys(counts).length;

  function stepQty(productId: number, delta: number) {
    setCounts((prev) => {
      const current = prev[productId] ?? 0;
      const next = Math.max(0, current + delta);
      if (next === 0 && (prev[productId] === undefined || prev[productId] === 0) && delta < 0) return prev;
      return { ...prev, [productId]: next };
    });
  }

  function openNumpad(item: PickItem) {
    setNumpad({ open: true, item });
  }

  function handleNumpadSave(value: number | null) {
    if (numpad.item) {
      setCounts((prev) => {
        const copy = { ...prev };
        if (value === null) delete copy[numpad.item!.product_id];
        else copy[numpad.item!.product_id] = value;
        return copy;
      });
    }
    setNumpad({ open: false, item: null });
  }

  function fmtQty(n: number): string {
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

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
        {countedN > 0 && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span className="text-[var(--fs-xs)] font-semibold text-green-600">
              {countedN} counted
            </span>
          </>
        )}
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

      {countedN > 0 && (
        <CountProgress counted={countedN} total={items.length} />
      )}

      {/* Ingredient list */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? 'No confirmed MOs' : 'No ingredients match'}
            body={items.length === 0 ? 'There are no confirmed manufacturing orders right now.' : 'Try a different search or category'}
          />
        ) : (
          grouped.map(([category, catItems]) => (
            <div key={category} className="mb-3">
              <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">
                {category} ({catItems.length})
              </p>
              {catItems.map((item) => {
                const val = counts[item.product_id] ?? null;
                return (
                  <div key={item.product_id} className="flex items-center gap-3 py-3 border-b border-gray-100">
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-lg)] font-semibold text-gray-900 truncate">
                        {item.product_name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[var(--fs-sm)] font-mono font-semibold text-blue-600">
                          Need: {fmtQty(item.total_demand)} {item.uom}
                        </span>
                        <span className="text-[var(--fs-xs)] text-gray-300">&middot;</span>
                        <span className="text-[var(--fs-xs)] text-gray-400">
                          {item.mo_count} MO{item.mo_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    <Stepper
                      value={val}
                      uom={item.uom}
                      onMinus={() => stepQty(item.product_id, -1)}
                      onPlus={() => stepQty(item.product_id, 1)}
                      onTap={() => openNumpad(item)}
                    />
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Numpad */}
      <NumpadModal
        open={numpad.open}
        productName={numpad.item?.product_name || ''}
        category={numpad.item?.category || ''}
        uom={numpad.item?.uom || 'Units'}
        initialValue={numpad.item ? (counts[numpad.item.product_id] ?? null) : null}
        showSystemQty={true}
        systemQty={numpad.item ? numpad.item.total_demand : null}
        locationName=""
        onSave={handleNumpadSave}
        onClose={() => setNumpad({ open: false, item: null })}
      />
    </div>
  );
}

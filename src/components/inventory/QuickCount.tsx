'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, SearchBar, Stepper, Spinner, EmptyState } from './ui';
import NumpadModal from './NumpadModal';

interface QuickCountProps {
  userRole: string;
}

export default function QuickCount({ userRole }: QuickCountProps) {
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [locFilter, setLocFilter] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [numpad, setNumpad] = useState<{ open: boolean; product: any | null }>({ open: false, product: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, locRes] = await Promise.all([
        fetch('/api/inventory/products').then((r) => r.json()),
        fetch('/api/inventory/locations').then((r) => r.json()),
      ]);
      setProducts(prodRes.products || []);
      const locs = locRes.locations || [];
      setLocations(locs);
      if (locs.length > 0 && !locFilter) setLocFilter(locs[0].id);
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  const categories = React.useMemo(() => {
    const cats = new Map<number, string>();
    products.forEach((p) => { if (p.categ_id) cats.set(p.categ_id[0], p.categ_id[1]); });
    return Array.from(cats.entries()).map(([id, name]) => ({ id, name }));
  }, [products]);

  const filtered = React.useMemo(() => {
    let list = [...products];
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== 'all') list = list.filter((p) => p.categ_id?.[0] === Number(catFilter));
    return list;
  }, [products, search, catFilter]);

  const countedN = Object.keys(counts).length;
  const locName = locations.find((l) => l.id === locFilter)?.complete_name?.split('/')[0] || '';

  function stepQty(pid: number, delta: number) {
    setCounts((prev) => {
      const current = prev[pid] ?? 0;
      const next = Math.max(0, current + delta);
      if (next === 0 && (prev[pid] === undefined || prev[pid] === 0) && delta < 0) return prev;
      const copy = { ...prev };
      copy[pid] = next;
      return copy;
    });
  }

  function openNumpad(product: any) {
    setNumpad({ open: true, product });
  }

  function handleNumpadSave(value: number | null) {
    if (numpad.product) {
      setCounts((prev) => {
        const copy = { ...prev };
        if (value === null) delete copy[numpad.product!.id];
        else copy[numpad.product!.id] = value;
        return copy;
      });
    }
    setNumpad({ open: false, product: null });
  }

  async function handleSubmit() {
    if (!locFilter || countedN === 0) return;
    setSubmitting(true);
    try {
      const entries = Object.entries(counts).map(([pid, qty]) => {
        const p = products.find((pr) => pr.id === Number(pid));
        return { product_id: Number(pid), counted_qty: qty, uom: p?.uom_id?.[1] || 'Units' };
      });
      await fetch('/api/inventory/quick-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, location_id: locFilter }),
      });
      setCounts({});
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (err) {
      console.error('Quick count submit failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Location pills */}
      <FilterBar>
        {locations.map((loc) => (
          <FilterPill key={loc.id}
            active={locFilter === loc.id}
            label={loc.complete_name?.split('/')[0] || loc.name}
            onClick={() => setLocFilter(loc.id)} />
        ))}
      </FilterBar>

      <SearchBar value={search} onChange={setSearch} placeholder="Type product name..." />

      {/* Category pills */}
      {categories.length > 1 && (
        <FilterBar>
          <FilterPill active={catFilter === 'all'} label="All" onClick={() => setCatFilter('all')} />
          {categories.map((c) => (
            <FilterPill key={c.id} active={catFilter === String(c.id)} label={c.name} onClick={() => setCatFilter(String(c.id))} />
          ))}
        </FilterBar>
      )}

      {/* Counted badge */}
      {countedN > 0 && (
        <div className="px-4 pb-2">
          <span className="text-[var(--fs-sm)] font-semibold text-green-700">{countedN} product{countedN !== 1 ? 's' : ''} counted</span>
        </div>
      )}

      {/* Product list */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {submitted && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-3 text-center">
            <span className="text-[var(--fs-base)] font-semibold text-green-700">Quick counts submitted for review</span>
          </div>
        )}
        {filtered.length === 0 ? (
          <EmptyState title="No products found" body="Try a different search or category" />
        ) : (
          <div className="flex flex-col">
            {filtered.map((p) => {
              const val = counts[p.id] ?? null;
              const uom = p.uom_id?.[1] || 'Units';
              const catName = p.categ_id?.[1] || '';
              return (
                <div key={p.id} className="flex items-center gap-3 py-3 border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{catName}</div>
                  </div>
                  <Stepper value={val} uom={uom}
                    onMinus={() => stepQty(p.id, -1)}
                    onPlus={() => stepQty(p.id, 1)}
                    onTap={() => openNumpad(p)} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Submit bar */}
      {countedN > 0 && (
        <div className="px-4 py-3">
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50">
            {submitting ? 'Submitting...' : `Submit ${countedN} quick count${countedN !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Numpad */}
      <NumpadModal
        open={numpad.open}
        productName={numpad.product?.name || ''}
        category={numpad.product?.categ_id?.[1] || ''}
        uom={numpad.product?.uom_id?.[1] || 'Units'}
        initialValue={numpad.product ? (counts[numpad.product.id] ?? null) : null}
        showSystemQty={userRole !== 'staff'}
        systemQty={null}
        locationName={locName}
        onSave={handleNumpadSave}
        onClose={() => setNumpad({ open: false, product: null })}
      />
    </div>
  );
}

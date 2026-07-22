'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { FilterBar, FilterPill, ProductThumb, leafCategory } from './ui';
import RecordLink from '@/components/ui/RecordLink';

/**
 * "Add products" popup for the list builder.
 *
 * The builder's main screen shows ONLY what's on the list; adding happens
 * here: search-first, tap +Add per item (flips to ✓ Added — tap again to
 * undo), or add a whole category / all search results at once. No checkbox
 * walls — you never lose track of what's selected, because the list itself
 * lives on the screen behind this sheet.
 */
export default function AddProductsSheet({
  products, selectedIds, onToggle, onAddMany, productImageIds, homeSpots, spotLabels, unitHint, onEditProduct, onNewProduct, onClose,
}: {
  products: any[];
  selectedIds: Set<number>;
  onToggle: (productId: number) => void;
  onAddMany: (productIds: number[]) => void;
  productImageIds: Set<number>;
  homeSpots: Record<number, number[]>;
  spotLabels: Record<number, string>;
  unitHint: (p: any) => string;
  /** Drill-down: open the product's editor overlay (fix a typo / wrong unit). */
  onEditProduct: (product: any) => void;
  /** No-dead-end: create a product that doesn't exist yet (prefilled with the
   *  current search), then it's added to the list. Omit to hide the affordance. */
  onNewProduct?: (initialName: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the search — this sheet is search-first by design.
  useEffect(() => {
    // Only claim focus if nothing else holds it — a ProductDetail overlay opened
    // within the 150ms window must keep focus, not have it yanked back here.
    const t = setTimeout(() => {
      const ae = document.activeElement;
      if (!ae || ae === document.body) inputRef.current?.focus();
    }, 150);
    return () => clearTimeout(t);
  }, []);

  const categories = useMemo(() => {
    const m = new Map<number, { id: number; name: string; count: number }>();
    for (const p of products) {
      if (!p.categ_id) continue;
      const [id, name] = p.categ_id;
      const e = m.get(id);
      if (e) e.count++;
      else m.set(id, { id, name, count: 1 });
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [products]);

  const visible = useMemo(() => {
    let list = products;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q)
        || (p.default_code && String(p.default_code).toLowerCase().includes(q)));
    }
    if (catFilter !== 'all') list = list.filter((p) => p.categ_id?.[0] === Number(catFilter));
    return list;
  }, [products, search, catFilter]);

  const notAdded = visible.filter((p) => !selectedIds.has(p.id));
  const activeCatName = catFilter !== 'all' ? leafCategory(categories.find((c) => String(c.id) === catFilter)?.name || '') : null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-end" role="dialog" aria-modal="true" aria-label="Add products">
      <div className="bg-white w-full h-[92vh] rounded-t-2xl flex flex-col">
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Add products</h3>
          <button onClick={onClose} className="bg-green-600 text-white text-[var(--fs-base)] font-bold px-4 py-2 rounded-xl active:bg-green-700">
            Done
          </button>
        </div>

        {/* Search-first */}
        <div className="px-4 pb-1">
          <div className="flex items-center gap-2 bg-gray-50 border-2 border-gray-200 rounded-xl px-3 focus-within:border-green-500">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or order code…"
              className="flex-1 py-3 bg-transparent outline-none text-[var(--fs-base)] text-gray-900 placeholder-gray-400"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search" className="text-gray-400 font-bold px-1">×</button>
            )}
          </div>
        </div>

        <FilterBar>
          <FilterPill active={catFilter === 'all'} label="All" onClick={() => setCatFilter('all')} />
          {categories.map((c) => (
            <FilterPill key={c.id} active={catFilter === String(c.id)} label={leafCategory(c.name)} count={c.count}
              onClick={() => setCatFilter(String(c.id))} />
          ))}
        </FilterBar>

        {/* Bulk add for the current view — replaces the old select-all wall */}
        {notAdded.length > 1 && (search || catFilter !== 'all') && (
          <div className="px-4 pb-2">
            <button onClick={() => onAddMany(notAdded.map((p) => p.id))}
              className="w-full py-2.5 rounded-lg bg-green-50 border border-green-200 text-green-800 text-[var(--fs-sm)] font-semibold active:bg-green-100">
              + Add all {notAdded.length} {activeCatName ? `in ${activeCatName}` : 'results'}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {visible.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 text-[var(--fs-base)] mb-4">Nothing matches — try another search.</p>
              {onNewProduct && (
                <button onClick={() => onNewProduct(search)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] active:bg-green-700">
                  + Create {search.trim() ? `“${search.trim()}”` : 'a new product'}
                </button>
              )}
            </div>
          ) : visible.slice(0, 200).map((p) => {
            const added = selectedIds.has(p.id);
            const spots = homeSpots[p.id] || [];
            return (
              <div key={p.id} className={`flex items-center gap-1 border-b border-gray-100 ${added ? 'opacity-95' : ''}`}>
                <button onClick={() => onToggle(p.id)}
                  className="flex-1 min-w-0 flex items-center gap-3 py-2.5 text-left active:opacity-80">
                  <ProductThumb productId={p.id} has={productImageIds.has(p.id)} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 truncate">{unitHint(p)}</div>
                    {spots.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {spots.map((sid) => (
                          <span key={sid} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
                            📍 {spotLabels[sid] || `Spot ${sid}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className={`flex-shrink-0 text-[var(--fs-sm)] font-bold px-3 py-1.5 rounded-lg border-[1.5px] ${
                    added ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-green-600 text-green-700'
                  }`}>
                    {added ? '✓ Added' : '+ Add'}
                  </span>
                </button>
                {/* Drill-down: fix the product itself (typo / wrong unit) — overlay keeps this sheet open */}
                <RecordLink type="product" id={p.id} label={p.name} onOpen={() => onEditProduct(p)} />
              </div>
            );
          })}
          {visible.length > 200 && (
            <p className="text-center text-gray-400 py-3 text-[var(--fs-xs)]">Showing the first 200 — refine the search to see the rest.</p>
          )}
        </div>

        {onNewProduct && (
          <div className="px-4 pt-2">
            <button onClick={() => onNewProduct(search)}
              className="w-full py-2.5 rounded-lg border-2 border-dashed border-green-300 text-green-700 text-[var(--fs-sm)] font-bold active:bg-green-50">
              + New product
            </button>
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-100 text-center text-[var(--fs-sm)] text-gray-500">
          <span className="font-bold text-gray-900">{selectedIds.size}</span> on this list — close to review it
        </div>
      </div>
    </div>
  );
}

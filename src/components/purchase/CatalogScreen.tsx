'use client';

import React from 'react';

interface CatalogOption {
  item_id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  price: number;
  category_name: string;
  supplier_id: number;
  supplier_name: string;
}

interface CatalogGroup {
  product_id: number;
  product_name: string;
  product_uom: string;
  category_name: string;
  options: CatalogOption[];
}

interface CatalogScreenProps {
  search: string;
  groups: CatalogGroup[];
  searching: boolean;
  addingId: number;
  locationName: string;
  onSearchChange: (v: string) => void;
  onAddToCart: (opt: CatalogOption) => void;
}

export default function CatalogScreen({
  search,
  groups,
  searching,
  addingId,
  locationName,
  onSearchChange,
  onAddToCart,
}: CatalogScreenProps) {
  return (
    <div className="px-4 py-3 pb-20">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-blue-500 transition-colors mb-3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search products across all suppliers..."
          autoFocus
          className="flex-1 bg-transparent outline-none text-[14px] text-gray-900 placeholder-gray-400"
        />
        {search && (
          <button onClick={() => onSearchChange('')} className="text-gray-400 text-[18px]" aria-label="Clear search">&times;</button>
        )}
      </div>

      {searching && (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}

      {!searching && search.trim().length < 2 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">&#128269;</div>
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">Type to search</div>
          <div className="text-[var(--fs-sm)] text-gray-500 px-8">
            Find the same product across every supplier &mdash; compare prices before adding to cart.
          </div>
        </div>
      )}

      {!searching && search.trim().length >= 2 && groups.length === 0 && (
        <div className="text-center py-12">
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No matches</div>
          <div className="text-[var(--fs-sm)] text-gray-500">
            No supplier carries a product matching &ldquo;{search}&rdquo; at {locationName}.
          </div>
        </div>
      )}

      {!searching && groups.map((g) => {
        const cheapest = g.options[0]?.price ?? 0;
        return (
          <div key={g.product_id} className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-3 overflow-hidden">
            <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-gray-100">
              <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center text-[var(--fs-lg)] flex-shrink-0 overflow-hidden relative">
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden>&#128230;</span>
                <img
                  src={`/api/purchase/products/image?product_id=${g.product_id}`}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover relative z-10"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-xs)] text-gray-400 font-semibold uppercase tracking-wide">
                  {g.product_uom} &bull; {g.category_name || 'Other'}
                </div>
                <div className="text-[var(--fs-base)] font-bold text-gray-900 truncate">{g.product_name}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {g.options.length} supplier{g.options.length === 1 ? '' : 's'} &bull; from{' '}
                  <span className="font-mono font-semibold text-gray-900">&euro;{cheapest.toFixed(2)}</span>
                </div>
              </div>
            </div>
            <div className="px-3.5">
              {g.options.map((opt, idx) => {
                const isCheapest = opt.price === cheapest && g.options.length > 1;
                return (
                  <div key={opt.item_id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-[13px] font-semibold text-gray-900 truncate">{opt.supplier_name}</div>
                        {isCheapest && (
                          <span className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-md flex-shrink-0">
                            Cheapest
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono">
                        &euro;{opt.price.toFixed(2)}/{opt.product_uom}
                        {idx > 0 && ` \u2022 +\u20ac${(opt.price - cheapest).toFixed(2)}`}
                      </div>
                    </div>
                    <button
                      onClick={() => onAddToCart(opt)}
                      disabled={addingId === opt.item_id}
                      className="h-9 px-3 rounded-lg bg-green-600 text-white text-[12px] font-bold active:bg-green-700 disabled:opacity-50 flex-shrink-0"
                    >
                      {addingId === opt.item_id ? '...' : 'Add to cart'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

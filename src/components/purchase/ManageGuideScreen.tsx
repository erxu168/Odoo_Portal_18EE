'use client';

import React from 'react';

interface GuideItem {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  price: number;
  category_name: string;
}

interface OdooProduct {
  id: number;
  name: string;
  uom: string;
  category_name: string;
  price: number;
}

interface ManageGuideScreenProps {
  items: GuideItem[];

  // Delivery Settings (collapsible)
  configOpen: boolean;
  orderDays: string[];
  deliveryDays: string[];
  leadTime: number;
  configSaving: boolean;
  onToggleConfig: () => void;
  onOrderDaysChange: (days: string[]) => void;
  onDeliveryDaysChange: (days: string[]) => void;
  onLeadTimeChange: (n: number) => void;
  onSaveConfig: () => void;

  // Product search (Odoo)
  search: string;
  category: string;
  searching: boolean;
  addingId: number;
  results: OdooProduct[];
  categories: string[];
  onSearchChange: (q: string) => void;
  onCategoryChange: (c: string) => void;
  onClearSearch: () => void;
  onAddProduct: (p: OdooProduct) => void;

  // Existing guide items
  onRemoveItem: (itemId: number) => void;
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export default function ManageGuideScreen({
  items,
  configOpen,
  orderDays,
  deliveryDays,
  leadTime,
  configSaving,
  onToggleConfig,
  onOrderDaysChange,
  onDeliveryDaysChange,
  onLeadTimeChange,
  onSaveConfig,
  search,
  category,
  searching,
  addingId,
  results,
  categories,
  onSearchChange,
  onCategoryChange,
  onClearSearch,
  onAddProduct,
  onRemoveItem,
}: ManageGuideScreenProps) {
  const guideProductIds = new Set(items.map((i) => i.product_id));
  const searchResults = results.filter((p) => !guideProductIds.has(p.id));
  const guideCats = Array.from(new Set(items.map((i) => i.category_name || 'Other')));
  const allFilterCats = ['All', ...categories.slice(0, 10)];

  return (
    <div className="px-4 py-3">
      {/* Delivery Settings — collapsible */}
      <button
        onClick={onToggleConfig}
        className="w-full flex items-center justify-between px-3.5 py-3 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-3 active:bg-gray-50"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round">
              <rect x="1" y="3" width="15" height="13" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <div>
            <div className="text-[var(--fs-sm)] font-bold text-gray-900">Delivery Settings</div>
            <div className="text-[var(--fs-xs)] text-gray-400">
              {orderDays.length > 0 ? `Order: ${orderDays.map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}` : 'Not configured'}
              {deliveryDays.length > 0 ? ` \u2022 Deliver: ${deliveryDays.map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}` : ''}
              {leadTime > 1 ? ` \u2022 ${leadTime}d lead` : ''}
            </div>
          </div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9CA3AF"
          strokeWidth="2"
          style={{ transform: configOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {configOpen && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5 py-3 mb-3 -mt-1">
          <div className="mb-3">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">
              Order days <span className="normal-case font-normal">(when staff must place orders)</span>
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAYS.map((d) => {
                const active = orderDays.includes(d);
                return (
                  <button
                    key={d}
                    onClick={() => onOrderDaysChange(active ? orderDays.filter((x) => x !== d) : [...orderDays, d])}
                    className={`px-3.5 py-2 rounded-lg text-[var(--fs-xs)] font-semibold ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mb-3">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">
              Delivery days <span className="normal-case font-normal">(when this supplier delivers)</span>
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAYS.map((d) => {
                const active = deliveryDays.includes(d);
                return (
                  <button
                    key={d}
                    onClick={() => onDeliveryDaysChange(active ? deliveryDays.filter((x) => x !== d) : [...deliveryDays, d])}
                    className={`px-3.5 py-2 rounded-lg text-[var(--fs-xs)] font-semibold ${active ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mb-3">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">
              Lead time <span className="normal-case font-normal">(min. days advance notice)</span>
            </label>
            <div className="flex items-center gap-2">
              <button onClick={() => onLeadTimeChange(Math.max(0, leadTime - 1))} className="w-10 h-10 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[18px] text-gray-600 active:bg-gray-100">-</button>
              <span className="w-12 text-center text-[var(--fs-lg)] font-bold font-mono text-gray-900">{leadTime}</span>
              <button onClick={() => onLeadTimeChange(leadTime + 1)} className="w-10 h-10 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[18px] text-gray-600 active:bg-gray-100">+</button>
              <span className="text-[var(--fs-xs)] text-gray-400 ml-1">{leadTime === 1 ? 'day' : 'days'}</span>
            </div>
          </div>
          <button
            onClick={onSaveConfig}
            disabled={configSaving}
            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-[var(--fs-sm)] font-bold active:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {configSaving ? 'Saving...' : 'Save delivery settings'}
          </button>
        </div>
      )}

      {/* Odoo product search */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-green-500 transition-colors mb-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search Odoo products to add..."
          className="flex-1 bg-transparent outline-none text-[var(--fs-base)] text-gray-900 placeholder-gray-400"
        />
        {search && (
          <button onClick={onClearSearch} className="text-gray-400 text-[18px]" aria-label="Clear search">&times;</button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
        {allFilterCats.map((cat) => (
          <button
            key={cat}
            onClick={() => onCategoryChange(cat)}
            className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 ${category === cat ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {(search || category !== 'All') && (
        <div className="mb-4">
          <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">
            {searching ? 'Searching...' : `${searchResults.length} results`}
            {searchResults.length > 0 && ' \u2014 tap + to add'}
          </div>
          {searching && (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
            </div>
          )}
          {!searching && searchResults.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
              {searchResults.map((product) => (
                <div key={product.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-[12px] flex-shrink-0">&#128230;</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{product.name}</div>
                    <div className="text-[11px] text-gray-500 font-mono">{product.uom} &bull; &euro;{product.price.toFixed(2)} &bull; {product.category_name}</div>
                  </div>
                  <button
                    onClick={() => onAddProduct(product)}
                    disabled={addingId === product.id}
                    className="w-9 h-9 rounded-lg bg-green-500 flex items-center justify-center text-white text-[18px] font-bold shadow-sm active:bg-green-600 flex-shrink-0 disabled:opacity-50"
                  >
                    {addingId === product.id ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '+'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {!searching && searchResults.length === 0 && results.length > 0 && (
            <div className="text-[12px] text-gray-500 text-center py-4">All matching products are already in the guide.</div>
          )}
          {!searching && results.length === 0 && (search || category !== 'All') && (
            <div className="text-[12px] text-gray-500 text-center py-4">No products found. Try a different search.</div>
          )}
        </div>
      )}

      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">In guide ({items.length})</div>
      {items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
          <div className="text-[var(--fs-sm)] text-gray-500">No products yet. Search above to add products from Odoo.</div>
        </div>
      ) : (
        guideCats.map((cat) => (
          <div key={cat}>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-2 pb-1">{cat}</div>
            <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5 mb-2">
              {items.filter((i) => (i.category_name || 'Other') === cat).map((item) => (
                <div key={item.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div>
                    <div className="text-[11px] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div>
                  </div>
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    className="text-[11px] font-semibold text-red-600 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100 active:bg-red-100 flex-shrink-0"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

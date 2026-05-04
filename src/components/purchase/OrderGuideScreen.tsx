'use client';

import React from 'react';
import SearchInput from './SearchInput';

// Mirror the full GuideItem shape from page.tsx so callbacks that need the
// whole object (e.g. openNumpad stores it in parent state) don't type-narrow.
interface GuideItem {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  price: number;
  price_source: string;
  category_name: string;
}

interface OrderGuideScreenProps {
  items: GuideItem[];
  search: string;
  category: string;
  quantities: Record<number, number>;
  supplierOrderDays: string[]; // parent pre-parses JSON so this component stays supplier-agnostic
  locationName: string;
  onSearchChange: (v: string) => void;
  onCategoryChange: (c: string) => void;
  onUpdateQty: (item: GuideItem, qty: number) => void;
  onOpenNumpad: (item: GuideItem) => void;
  onViewCart: () => void;
}

export default function OrderGuideScreen({
  items,
  search,
  category,
  quantities,
  supplierOrderDays,
  locationName,
  onSearchChange,
  onCategoryChange,
  onUpdateQty,
  onOpenNumpad,
  onViewCart,
}: OrderGuideScreenProps) {
  const allCategories = ['All', ...Array.from(new Set(items.map((i) => i.category_name || 'Other')))];
  const filtered = items.filter((i) => {
    if (search && !i.product_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (category !== 'All' && (i.category_name || 'Other') !== category) return false;
    return true;
  });
  const categories = Array.from(new Set(filtered.map((i) => i.category_name || 'Other')));
  const cartItemCount = Object.values(quantities).filter((q) => q > 0).length;
  const cartAmount = items.reduce((sum, i) => sum + (quantities[i.product_id] || 0) * i.price, 0);
  const dayStr = supplierOrderDays.length > 0
    ? supplierOrderDays.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(' & ')
    : '';

  return (
    <>
      <div className="px-4 py-3 pb-44">
        {dayStr && (
          <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-200 mb-3 text-[var(--fs-sm)] text-blue-800">
            <span className="text-[14px] mt-0.5">&#128197;</span>
            <span>Order days: <strong>{dayStr}</strong></span>
          </div>
        )}
        <SearchInput value={search} onChange={onSearchChange} placeholder="Search products..." />
        <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat)}
              className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 ${category === cat ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
            >
              {cat}
            </button>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No products found</div>
          </div>
        )}
        {categories.map((cat) => (
          <div key={cat}>
            <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pt-3 pb-2 flex justify-between">
              <span>{cat}</span>
              <span className="font-mono text-gray-300">{filtered.filter((i) => (i.category_name || 'Other') === cat).length}</span>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
              {filtered.filter((i) => (i.category_name || 'Other') === cat).map((item) => {
                const qty = quantities[item.product_id] || 0;
                return (
                  <div key={item.id} className={`flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0 ${qty > 0 ? 'bg-green-50 -mx-3.5 px-3.5 rounded-lg mb-1' : ''}`}>
                    <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center text-[var(--fs-lg)] flex-shrink-0 overflow-hidden relative">
                      <span className="absolute inset-0 flex items-center justify-center" aria-hidden>&#128230;</span>
                      <img
                        src={`/api/purchase/products/image?product_id=${item.product_id}`}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover relative z-10"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-xs)] text-gray-400 font-semibold uppercase tracking-wide">{item.product_uom}</div>
                      <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div>
                      <div className="text-[var(--fs-sm)] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div>
                    </div>
                    {qty > 0 ? (
                      <div className="flex items-center flex-shrink-0">
                        <button onClick={() => onUpdateQty(item, Math.max(0, qty - 1))} className="w-11 h-11 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[var(--fs-xl)] text-gray-600 active:bg-gray-100">-</button>
                        <button onClick={() => onOpenNumpad(item)} className="w-11 h-11 flex items-center justify-center text-[var(--fs-lg)] font-bold font-mono text-gray-900">{qty}</button>
                        <button onClick={() => onUpdateQty(item, qty + 1)} className="w-11 h-11 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[var(--fs-xl)] text-gray-600 active:bg-gray-100">+</button>
                      </div>
                    ) : (
                      <button onClick={() => onUpdateQty(item, 1)} className="w-11 h-11 rounded-lg bg-green-600 flex items-center justify-center text-white text-[var(--fs-xl)] font-bold shadow-sm active:bg-green-700 flex-shrink-0">+</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {cartItemCount > 0 && (
        <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
          <div className="flex justify-between items-center mb-2">
            <div>
              <div className="text-[18px] font-extrabold font-mono text-gray-900">&euro;{cartAmount.toFixed(2)}</div>
              <div className="text-[var(--fs-xs)] text-gray-500">{cartItemCount} items &bull; shared cart ({locationName})</div>
            </div>
          </div>
          <button
            onClick={onViewCart}
            className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all"
          >
            View cart &rarr;
          </button>
        </div>
      )}
    </>
  );
}

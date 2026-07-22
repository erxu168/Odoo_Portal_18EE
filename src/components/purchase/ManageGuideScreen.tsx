'use client';

import React from 'react';
import SortableGuideItems from './SortableGuideItems';

import SupplierForm, { type SupplierFormValues } from './SupplierForm';

interface GuideItem {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  price: number;
  category_name: string;
  par_level?: number;
  product_code?: string;
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

  // Delivery settings (collapsible) — edited by the ONE shared SupplierForm.
  configOpen: boolean;
  configSaving: boolean;
  supplier: { name: string; email: string; phone?: string; send_method: string; order_days: string; delivery_days?: string; lead_time_days: number; min_order_value: number; approval_required: number } | null;
  onToggleConfig: () => void;
  onSaveSupplier: (v: SupplierFormValues) => void;

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
  onReorder: (itemIds: number[]) => void;

  // Create a brand-new product (opens the create-product sheet)
  onCreateNew: () => void;

  // Load-more paging for the product list
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}


export default function ManageGuideScreen({
  items,
  configOpen,
  configSaving,
  supplier,
  onToggleConfig,
  onSaveSupplier,
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
  onReorder,
  onCreateNew,
  hasMore,
  loadingMore,
  onLoadMore,
}: ManageGuideScreenProps) {
  const parseDays = (raw?: string) => { try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a as string[] : []; } catch { return []; } };
  const orderDays = parseDays(supplier?.order_days);
  const deliveryDays = parseDays(supplier?.delivery_days);
  const leadTime = supplier?.lead_time_days ?? 1;
  const guideProductIds = new Set(items.map((i) => i.product_id));
  const searchResults = results.filter((p) => !guideProductIds.has(p.id));
  const allFilterCats = ['All', ...categories.slice(0, 10)];

  return (
    <div className="px-4 py-3">
      {/* Delivery Settings — collapsible */}
      <button
        onClick={onToggleConfig}
        className="w-full flex items-center justify-between px-3.5 py-3 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-3 active:bg-gray-50"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5800A" strokeWidth="2" strokeLinecap="round">
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

      {configOpen && supplier && (
        <div className="mb-3">
          <SupplierForm
            variant="inline"
            mode="edit"
            initial={supplier}
            saving={configSaving}
            onSave={onSaveSupplier}
            onCancel={onToggleConfig}
          />
        </div>
      )}

      {/* Odoo product search */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-[#F5800A] transition-colors mb-2">
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
            className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 ${category === cat ? 'bg-[#F5800A] text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      <button
        onClick={onCreateNew}
        className="w-full mb-3 py-2.5 rounded-xl border border-dashed border-[#F5800A] text-[#F5800A] text-[var(--fs-sm)] font-semibold active:bg-orange-50"
      >
        + Create new product
      </button>

      <div className="mb-4">
          <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">
            {searching ? 'Searching...' : `${searchResults.length} results`}
            {searchResults.length > 0 && ' \u2014 tap + to add to the template'}
          </div>
          {searching && (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-[#F5800A] rounded-full animate-spin" />
            </div>
          )}
          {!searching && searchResults.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
              {searchResults.map((product) => (
                <div key={product.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
                  <div className="w-9 h-9 rounded-lg bg-orange-50 flex items-center justify-center text-[12px] flex-shrink-0">&#128230;</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{product.name}</div>
                    <div className="text-[11px] text-gray-500 font-mono">{product.uom} &bull; &euro;{product.price.toFixed(2)} &bull; {product.category_name}</div>
                  </div>
                  <button
                    onClick={() => onAddProduct(product)}
                    disabled={addingId === product.id}
                    aria-label="Add to template"
                    className="w-11 h-11 rounded-lg bg-[#F5800A] flex items-center justify-center text-white text-[18px] shadow-sm active:bg-[#E86000] flex-shrink-0 disabled:opacity-50"
                  >
                    {addingId === product.id ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>}
                  </button>
                </div>
              ))}
            </div>
          )}
          {!searching && hasMore && (
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="w-full mt-2.5 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[var(--fs-sm)] font-semibold active:bg-gray-200 disabled:opacity-50"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          )}
          {!searching && searchResults.length === 0 && results.length > 0 && (
            <div className="text-[12px] text-gray-500 text-center py-4">All matching products are already in the guide.</div>
          )}
          {!searching && results.length === 0 && (
            <div className="text-[12px] text-gray-500 text-center py-4">No products found. Try a different search, or create a new product above.</div>
          )}
        </div>

      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">In guide ({items.length})</div>
      {items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
          <div className="text-[var(--fs-sm)] text-gray-500">No products yet. Search above to add products from Odoo.</div>
        </div>
      ) : (
        <SortableGuideItems items={items} onReorder={onReorder} onRemove={onRemoveItem} />
      )}
      {items.length > 0 && (
        <p className="text-[11px] text-gray-400 text-center pb-2">Drag the handle to match your walk-in order.</p>
      )}
    </div>
  );
}

'use client';

import React from 'react';
import SortableGuideItems from './SortableGuideItems';

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

  // Delivery Settings (collapsible)
  configOpen: boolean;
  orderDays: string[];
  deliveryDays: string[];
  leadTime: number;
  configSaving: boolean;
  configSaved: boolean;
  onToggleConfig: () => void;
  onOrderDaysChange: (days: string[]) => void;
  onDeliveryDaysChange: (days: string[]) => void;
  onLeadTimeChange: (n: number) => void;

  // Supplier details (edit + save-as-you-go)
  name: string;
  email: string;
  phone: string;
  sendMethod: string;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onSendMethodChange: (v: string) => void;

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

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export default function ManageGuideScreen({
  items,
  configOpen,
  orderDays,
  deliveryDays,
  leadTime,
  configSaving,
  configSaved,
  onToggleConfig,
  onOrderDaysChange,
  onDeliveryDaysChange,
  onLeadTimeChange,
  name,
  email,
  phone,
  sendMethod,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onSendMethodChange,
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

      {configOpen && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5 py-3 mb-3 -mt-1">
          {/* Supplier details */}
          <div className="mb-3">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Supplier name</label>
            <input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Supplier name"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 h-10 text-[var(--fs-sm)] text-gray-900 outline-none focus:border-[#F5800A] mb-2.5"
            />
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                  placeholder="orders@supplier.com"
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 h-10 text-[var(--fs-sm)] text-gray-900 outline-none focus:border-[#F5800A]"
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  placeholder="+49 ..."
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 h-10 text-[var(--fs-sm)] text-gray-900 outline-none focus:border-[#F5800A]"
                />
              </div>
            </div>
          </div>
          <div className="mb-3">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">
              Order method <span className="normal-case font-normal">(how orders reach this supplier)</span>
            </label>
            <div className="flex gap-1.5">
              {([['email', 'Email'], ['whatsapp', 'WhatsApp'], ['manual', 'Manual']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => onSendMethodChange(val)}
                  className={`flex-1 px-3 py-2 rounded-lg text-[var(--fs-xs)] font-semibold ${sendMethod === val ? 'bg-[#F5800A] text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
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
                    className={`px-3.5 py-2 rounded-lg text-[var(--fs-xs)] font-semibold ${active ? 'bg-[#F5800A] text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
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
                    className={`px-3.5 py-2 rounded-lg text-[var(--fs-xs)] font-semibold ${active ? 'bg-[#F5800A] text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
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
          <div className={`text-[var(--fs-xs)] pt-1 ${configSaved && !configSaving ? 'text-green-600' : 'text-gray-400'}`}>
            {configSaving ? 'Saving…' : configSaved ? '✓ Saved' : 'Changes save automatically'}
          </div>
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

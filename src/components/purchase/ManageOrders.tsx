'use client';

import React, { useState, useRef, useCallback } from 'react';
import SwipeToDelete from '@/components/ui/SwipeToDelete';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ManageOrdersProps {
  suppliers: any[];
  locationId: number;
  isAdmin: boolean;
  onOpenGuide: (supplier: any) => void;
  onDeleteGuide: (supplierId: number, supplierName: string) => void;
  onAddSupplier?: (odooPartner: any) => void;
  onSeed: () => void;
  seedMsg: string;
}

export default function ManageOrders({
  suppliers,
  isAdmin,
  onOpenGuide,
  onDeleteGuide,
  onAddSupplier,
  onSeed,
  seedMsg,
}: ManageOrdersProps) {
  const withProducts = suppliers.filter((s: any) => s.product_count > 0);
  const emptyGuides = suppliers.filter((s: any) => s.product_count === 0);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setSearchError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setSearchResults([]); setSearching(false); return; }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch('/api/purchase/suppliers/search?q=' + encodeURIComponent(query) + '&limit=15');
        if (!r.ok) { setSearchError('Search failed (' + r.status + ')'); setSearchResults([]); setSearching(false); return; }
        const d = await r.json();
        if (d.error) { setSearchError(d.error); setSearchResults([]); }
        else { setSearchResults(d.suppliers || []); }
      } catch { setSearchError('Network error'); setSearchResults([]); }
      finally { setSearching(false); }
    }, 500);
  }, []);

  function handleSelectSupplier(partner: any) {
    if (onAddSupplier) onAddSupplier(partner);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  function closeSearch() {
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearching(false);
    setSearchError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }

  return (
    <div className="px-4 py-3">
      {/* Section 1: Suppliers with products — swipe to delete */}
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">
        Order lists ({withProducts.length})
      </div>
      {withProducts.length > 0 && (
        <p className="text-[11px] text-gray-400 mb-3">Swipe left to delete an order list</p>
      )}

      {suppliers.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-[14px] font-semibold text-gray-900 mb-1">No suppliers yet</div>
          <div className="text-[12px] text-gray-500 mb-4">Search for a supplier below to get started</div>
          {isAdmin && seedMsg && <p className="text-[12px] text-gray-500 mt-3">{seedMsg}</p>}
        </div>
      ) : (
        <>
          {withProducts.length === 0 && emptyGuides.length === 0 && (
            <div className="text-center py-6 mb-2">
              <div className="text-[14px] font-semibold text-gray-900 mb-1">No order lists yet</div>
              <div className="text-[12px] text-gray-500">Search for a supplier below to create one</div>
            </div>
          )}

          {withProducts.map((s: any) => (
            <SwipeToDelete key={s.id} onDelete={() => onDeleteGuide(s.id, s.name)}>
              <button
                onClick={() => onOpenGuide(s)}
                className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">
                  {s.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-gray-900 truncate">{s.name}</div>
                  <div className="text-[11px] text-gray-500">
                    {s.product_count} products {'\u2022'} Tap to edit
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2">
                  <path d="M9 5l7 7-7 7"/>
                </svg>
              </button>
            </SwipeToDelete>
          ))}

          {/* Section 2: Suppliers added but with 0 products — tap to add products, swipe to remove */}
          {emptyGuides.length > 0 && (
            <>
              <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pt-4 pb-2">
                Empty lists ({emptyGuides.length})
              </div>
              <p className="text-[11px] text-gray-400 mb-3">Tap to add products, swipe left to remove</p>
              {emptyGuides.map((s: any) => (
                <SwipeToDelete key={s.id} onDelete={() => onDeleteGuide(s.id, s.name)}>
                  <button
                    onClick={() => onOpenGuide(s)}
                    className="w-full flex items-center gap-3 p-3.5 bg-gray-50 border border-dashed border-gray-300 rounded-xl active:bg-gray-100 transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[14px] font-bold text-gray-400 flex-shrink-0">
                      {s.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gray-500 truncate">{s.name}</div>
                      <div className="text-[11px] text-gray-400">No products yet {'\u2022'} Tap to add</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2">
                      <path d="M9 5l7 7-7 7"/>
                    </svg>
                  </button>
                </SwipeToDelete>
              ))}
            </>
          )}
        </>
      )}

      {/* Add supplier search */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        {!showSearch ? (
          <button
            onClick={() => setShowSearch(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-[13px] font-semibold active:bg-green-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            Add supplier from Odoo
          </button>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-green-500 transition-colors">
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="text-gray-400 flex-shrink-0">
                  <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  placeholder="Type supplier name..."
                  className="flex-1 bg-transparent outline-none text-[14px] text-gray-900 placeholder-gray-400"
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="text-gray-400 text-[18px]">&times;</button>
                )}
              </div>
              <button onClick={closeSearch} className="text-[12px] font-semibold text-gray-500 px-2 py-2">
                Cancel
              </button>
            </div>

            {!searching && searchQuery.length === 0 && (
              <div className="text-[12px] text-gray-400 text-center py-4">Type at least 2 characters to search Odoo suppliers</div>
            )}

            {!searching && searchQuery.length === 1 && (
              <div className="text-[12px] text-gray-400 text-center py-4">Keep typing...</div>
            )}

            {searching && (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
              </div>
            )}

            {searchError && (
              <div className="text-[12px] text-red-500 text-center py-4">{searchError}</div>
            )}

            {!searching && searchQuery.length >= 2 && searchResults.length === 0 && !searchError && (
              <div className="text-[12px] text-gray-500 text-center py-6">No suppliers found matching &quot;{searchQuery}&quot;</div>
            )}

            {searchResults.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
                {searchResults.map((partner: any) => (
                  <button
                    key={partner.odoo_id}
                    onClick={() => !partner.already_added && handleSelectSupplier(partner)}
                    disabled={partner.already_added}
                    className={'w-full flex items-center gap-3 px-3.5 py-3 border-b border-gray-100 last:border-0 text-left transition-colors ' +
                      (partner.already_added ? 'opacity-50 cursor-not-allowed' : 'active:bg-gray-50')
                    }
                  >
                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-[12px] font-bold text-blue-600 flex-shrink-0">
                      {partner.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">{partner.name}</div>
                      {partner.email && <div className="text-[11px] text-gray-400 truncate">{partner.email}</div>}
                    </div>
                    {partner.already_added ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-gray-100 text-gray-500 flex-shrink-0">Added</span>
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EA580C" strokeWidth="2" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14"/>
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import SwipeToDelete from '@/components/ui/SwipeToDelete';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ManageOrdersProps {
  suppliers: any[];
  locationId: number;
  isAdmin: boolean;
  onOpenGuide: (supplier: any) => void;
  onDeleteGuide: (supplierId: number, supplierName: string) => void;
  onAddSupplier: (odooPartner: any) => void;
  onSeed: () => void;
  seedMsg: string;
}

/**
 * ManageOrders — Edit order guides screen.
 * Top: existing order lists with swipe-to-delete.
 * Bottom: "Add supplier" search that queries Odoo live.
 */
export default function ManageOrders({
  suppliers,
  isAdmin,
  onOpenGuide,
  onDeleteGuide,
  onAddSupplier,
  onSeed,
  seedMsg,
}: ManageOrdersProps) {
  const withGuides = suppliers.filter((s: any) => s.product_count > 0);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [debounceTimer, setDebounceTimer] = useState<any>(null);

  function handleSearch(query: string) {
    setSearchQuery(query);
    setSearchError('');
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.length < 2) { setSearchResults([]); return; }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/purchase/suppliers/search?q=${encodeURIComponent(query)}&limit=15`);
        const d = await r.json();
        if (d.error) { setSearchError(d.error); setSearchResults([]); }
        else { setSearchResults(d.suppliers || []); }
      } catch (e) { setSearchError('Search failed'); setSearchResults([]); }
      finally { setSearching(false); }
    }, 400);
    setDebounceTimer(timer);
  }

  function handleSelectSupplier(partner: any) {
    onAddSupplier(partner);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  return (
    <div className="px-4 py-3">
      {/* Existing order lists */}
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">
        Order lists ({withGuides.length})
      </div>
      {withGuides.length > 0 && (
        <p className="text-[11px] text-gray-400 mb-3">Swipe left to delete an order list</p>
      )}

      {suppliers.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-[13px] text-gray-500 mb-4">No suppliers yet. Seed from Odoo first.</div>
          {isAdmin && (
            <button onClick={onSeed} className="py-3 px-6 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30">
              Seed suppliers from Odoo
            </button>
          )}
          {seedMsg && <p className="text-[12px] text-gray-500 mt-3">{seedMsg}</p>}
        </div>
      ) : (
        <>
          {withGuides.length === 0 && (
            <div className="text-center py-6 mb-4">
              <div className="text-[28px] mb-2">\ud83d\udccb</div>
              <div className="text-[14px] font-semibold text-[#1F2933] mb-1">No order lists yet</div>
              <div className="text-[12px] text-gray-500">Search for a supplier below to create one</div>
            </div>
          )}

          {withGuides.map((s: any) => (
            <SwipeToDelete key={s.id} onDelete={() => onDeleteGuide(s.id, s.name)}>
              <button
                onClick={() => onOpenGuide(s)}
                className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-[#F1F3F5] flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">
                  {s.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-[#1F2933] truncate">{s.name}</div>
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
        </>
      )}

      {/* Add supplier — search from Odoo */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        {!showSearch ? (
          <button
            onClick={() => setShowSearch(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-600 text-[13px] font-semibold active:bg-orange-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            Add supplier from Odoo
          </button>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-orange-400 transition-colors">
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="text-gray-400 flex-shrink-0">
                  <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  placeholder="Search Odoo suppliers..."
                  className="flex-1 bg-transparent outline-none text-[14px] text-[#1F2933] placeholder-gray-400"
                  autoFocus
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="text-gray-400 text-[18px]">&times;</button>
                )}
              </div>
              <button
                onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
                className="text-[12px] font-semibold text-gray-500 px-2 py-2"
              >
                Cancel
              </button>
            </div>

            {searching && (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
              </div>
            )}

            {searchError && (
              <div className="text-[12px] text-red-500 text-center py-4">{searchError}</div>
            )}

            {!searching && searchQuery.length >= 2 && searchResults.length === 0 && !searchError && (
              <div className="text-[12px] text-gray-500 text-center py-6">No suppliers found in Odoo matching "{searchQuery}"</div>
            )}

            {searchResults.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
                {searchResults.map((partner: any) => (
                  <button
                    key={partner.odoo_id}
                    onClick={() => !partner.already_added && handleSelectSupplier(partner)}
                    disabled={partner.already_added}
                    className={`w-full flex items-center gap-3 px-3.5 py-3 border-b border-gray-100 last:border-0 text-left transition-colors ${
                      partner.already_added ? 'opacity-50 cursor-not-allowed' : 'active:bg-gray-50'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#F1F3F5] flex items-center justify-center text-[12px] font-bold text-blue-600 flex-shrink-0">
                      {partner.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#1F2933] truncate">{partner.name}</div>
                      {partner.email && <div className="text-[11px] text-gray-400 truncate">{partner.email}</div>}
                    </div>
                    {partner.already_added ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-gray-100 text-gray-500 flex-shrink-0">Added</span>
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EA580C" strokeWidth="2" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14"/>
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {searchQuery.length < 2 && searchQuery.length > 0 && (
              <div className="text-[12px] text-gray-400 text-center py-4">Type at least 2 characters to search</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

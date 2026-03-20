'use client';

import React from 'react';
import SwipeToDelete from '@/components/ui/SwipeToDelete';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ManageOrdersProps {
  suppliers: any[];
  locationId: number;
  isAdmin: boolean;
  onOpenGuide: (supplier: any) => void;
  onDeleteGuide: (supplierId: number, supplierName: string) => void;
  onSeed: () => void;
  seedMsg: string;
}

/**
 * ManageOrders — Edit order guides screen.
 * Only shows suppliers that have an order list (product_count > 0).
 * Swipe left to reveal delete button (iOS-style).
 */
export default function ManageOrders({
  suppliers,
  isAdmin,
  onOpenGuide,
  onDeleteGuide,
  onSeed,
  seedMsg,
}: ManageOrdersProps) {
  // Only show suppliers that have an order list
  const withGuides = suppliers.filter((s: any) => s.product_count > 0);
  const withoutGuides = suppliers.filter((s: any) => s.product_count === 0);

  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Order lists ({withGuides.length})</div>
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
            <div className="text-center py-8 mb-4">
              <div className="text-[32px] mb-2">&#128203;</div>
              <div className="text-[14px] font-semibold text-[#1F2933] mb-1">No order lists yet</div>
              <div className="text-[12px] text-gray-500">Tap a supplier below to create one</div>
            </div>
          )}

          {withGuides.map((s: any) => (
            <SwipeToDelete
              key={s.id}
              onDelete={() => onDeleteGuide(s.id, s.name)}
            >
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

          {/* Suppliers without order lists — available to add */}
          {withoutGuides.length > 0 && (
            <>
              <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pt-4 pb-2">
                Add order list ({withoutGuides.length} suppliers available)
              </div>
              {withoutGuides.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => onOpenGuide(s)}
                  className="w-full flex items-center gap-3 p-3.5 bg-gray-50 border border-dashed border-gray-300 rounded-xl mb-2.5 active:bg-gray-100 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[14px] font-bold text-gray-400 flex-shrink-0">
                    {s.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-500 truncate">{s.name}</div>
                    <div className="text-[11px] text-gray-400">Tap to create order list</div>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EA580C" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                  </div>
                </button>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import React from 'react';

// Mirrors page.tsx's Supplier so callbacks passing the full record stay assignable.
interface Supplier {
  id: number;
  name: string;
  email: string;
  product_count: number;
  order_days: string;
  delivery_days?: string;
  lead_time_days: number;
  min_order_value: number;
  approval_required: number;
  send_method: string;
}

interface ManagePurchasesScreenProps {
  suppliers: Supplier[];
  isAdmin: boolean;
  seedMsg: string;
  onAddSupplier: () => void;
  onInsights: () => void;
  onOpenGuide: (supplier: Supplier) => void;
  onRequestDelete: (supplier: Supplier) => void;
  onSeed: () => void;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

export default function ManagePurchasesScreen({
  suppliers,
  isAdmin,
  seedMsg,
  onAddSupplier,
  onInsights,
  onOpenGuide,
  onRequestDelete,
  onSeed,
}: ManagePurchasesScreenProps) {
  return (
    <div className="px-4 py-3">
      <div className="flex gap-2 mb-3">
        <button
          onClick={onAddSupplier}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-[#2563EB] text-white text-[13px] font-bold shadow-sm active:scale-[0.98] transition-transform"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add supplier
        </button>
        <button
          onClick={onInsights}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-bold active:bg-gray-50 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          Insights
        </button>
      </div>

      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Edit order guides</div>

      {suppliers.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-[var(--fs-sm)] text-gray-500 mb-4">
            No suppliers yet. Tap <span className="font-semibold text-blue-600">Add supplier</span> above, or seed from Odoo.
          </div>
          {isAdmin && (
            <button
              onClick={onSeed}
              className="py-3 px-6 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30"
            >
              Seed suppliers from Odoo
            </button>
          )}
          {seedMsg && <p className="text-[12px] text-gray-500 mt-3">{seedMsg}</p>}
        </div>
      ) : (
        suppliers.map((s) => (
          <div key={s.id} className="flex items-center gap-2 mb-2.5">
            <button
              onClick={() => onOpenGuide(s)}
              className="flex-1 flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform text-left min-w-0"
            >
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">
                {s.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-gray-900 truncate">{s.name}</div>
                <div className="text-[11px] text-gray-500">{s.product_count} products &bull; Tap to edit</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={() => onRequestDelete(s)}
              aria-label={`Delete ${s.name}`}
              className="w-11 h-11 flex-shrink-0 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 active:bg-red-100 transition-colors"
            >
              <TrashIcon />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

'use client';

import React from 'react';
import type { ComponentAvailability } from '@/types/manufacturing';
import { BomIngredientListView } from './BomIngredientList';
import { BomOperationListView } from './BomOperationList';

export interface BomViewModeProps {
  bom: any;
  components: ComponentAvailability[];
  operations: any[];
  expandedSubBoms: Set<number>;
  toggleSubBom: (productId: number) => void;
  fmt: (n: number) => string;
  onCreateMo: (bomId: number) => void;
}

export default function BomViewMode({
  bom,
  components,
  operations,
  expandedSubBoms,
  toggleSubBom,
  fmt,
  onCreateMo,
}: BomViewModeProps) {
  const uom = bom.product_uom_id[1];

  return (
    <>
      {/* Output quantity (read-only) */}
      <div className="px-4 pb-2">
        <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-1.5">Output quantity ({uom})</div>
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <span className="text-[var(--fs-xxl)] font-bold text-gray-900 font-mono">{fmt(bom.product_qty)}</span>
        </div>
      </div>

      {/* Read-only ingredient list */}
      <BomIngredientListView
        components={components}
        expandedSubBoms={expandedSubBoms}
        toggleSubBom={toggleSubBom}
        fmt={fmt}
      />

      {/* Work order steps (read-only) */}
      <BomOperationListView operations={operations} />

      {/* Bottom actions */}
      <div className="px-4 pb-8">
        <button onClick={() => onCreateMo(bom.id)}
          className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform">
          Create manufacturing order
        </button>
      </div>
    </>
  );
}

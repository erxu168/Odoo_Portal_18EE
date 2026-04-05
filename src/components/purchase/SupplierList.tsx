import React from 'react';
import SearchInput from './SearchInput';
import { Supplier } from './types';

interface SupplierListProps {
  suppliers: Supplier[];
  supplierSearch: string;
  setSupplierSearch: (v: string) => void;
  loading: boolean;
  isAdmin: boolean;
  runSeed: () => void;
  seedMsg: string;
  openGuide: (supplier: Supplier) => void;
}

export default function SupplierList({ suppliers, supplierSearch, setSupplierSearch, loading, isAdmin, runSeed, seedMsg, openGuide }: SupplierListProps) {
  const filtered = suppliers.filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()));
  return (
    <div className="px-4 py-3">
      <SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" /></div>
      ) : filtered.length === 0 && suppliers.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">&#128722;</div>
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No suppliers yet</div>
          <div className="text-[var(--fs-sm)] text-gray-500 mb-4">Set up suppliers and order guides first.</div>
          {isAdmin && <>
            <button onClick={runSeed} className="w-full max-w-[300px] py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 mb-3">Seed suppliers from Odoo</button>
            {seedMsg && <p className="text-[12px] text-gray-500">{seedMsg}</p>}
          </>}
        </div>
      ) : (<>
        {filtered.map(s => {
          const days = (() => { try { return JSON.parse(s.order_days); } catch { return []; } })();
          const dayStr = days.length > 0 ? days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(' & ') : '';
          return (
            <button key={s.id} onClick={() => openGuide(s)} className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] mb-2.5 active:scale-[0.98] transition-transform text-left">
              <div className="w-14 h-14 rounded-[14px] bg-gray-100 flex items-center justify-center text-[var(--fs-lg)] font-bold text-blue-600 flex-shrink-0">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-lg)] font-bold text-gray-900 truncate">{s.name}</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{s.product_count} products in guide</div>
                {dayStr && <div className="text-[var(--fs-xs)] font-semibold text-blue-600 mt-1">Orders: {dayStr}</div>}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          );
        })}
      </>)}
    </div>
  );
}

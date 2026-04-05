import React from 'react';
import { Supplier } from './types';

interface ManageScreenProps {
  suppliers: Supplier[];
  isAdmin: boolean;
  runSeed: () => void;
  seedMsg: string;
  openManageGuide: (supplier: Supplier) => void;
}

export default function ManageScreen({ suppliers, isAdmin, runSeed, seedMsg, openManageGuide }: ManageScreenProps) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Edit order guides</div>
      {suppliers.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-[var(--fs-sm)] text-gray-500 mb-4">No suppliers yet. Seed from Odoo first.</div>
          {isAdmin && <button onClick={runSeed} className="py-3 px-6 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30">Seed suppliers from Odoo</button>}
          {seedMsg && <p className="text-[12px] text-gray-500 mt-3">{seedMsg}</p>}
        </div>
      ) : (
        suppliers.map(s => (
          <button key={s.id} onClick={() => openManageGuide(s)} className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-2.5 active:scale-[0.98] transition-transform text-left">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-gray-900 truncate">{s.name}</div>
              <div className="text-[11px] text-gray-500">{s.product_count} products &bull; Tap to edit</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
          </button>
        ))
      )}
    </div>
  );
}

'use client';

import React from 'react';

/**
 * Standard numpad component for purchase module.
 * Renamed from Numpad.tsx to avoid casing conflict with NumPad.tsx (manufacturing).
 */
interface PurchaseNumpadProps {
  open: boolean;
  value: string;
  label?: string;
  sublabel?: string;
  onKey: (key: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function PurchaseNumpad({ open, value, label, sublabel, onKey, onConfirm, onClose }: PurchaseNumpadProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-[100] flex items-end justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-[20px] w-full max-w-lg p-5 pb-7" onClick={e => e.stopPropagation()}>
        {(label || sublabel) && (
          <div className="text-center pb-2">
            {sublabel && <div className="text-[12px] text-gray-400">{sublabel}</div>}
            {label && <div className="text-[15px] font-bold text-gray-900">{label}</div>}
          </div>
        )}
        <div className="text-center text-[36px] font-extrabold font-mono text-gray-900 pb-4 min-h-[52px]">
          {value || '0'}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <button onClick={() => onKey('C')} className="col-span-2 h-14 rounded-xl bg-green-100 border border-green-200 text-green-700 text-[18px] font-bold flex items-center justify-center active:bg-green-200">C</button>
          <button onClick={() => onKey('del')} className="h-14 rounded-xl bg-gray-100 border border-gray-200 text-gray-500 text-[15px] font-semibold flex items-center justify-center active:bg-gray-200">Delete</button>
          {['1','2','3','4','5','6','7','8','9'].map(k => (
            <button key={k} onClick={() => onKey(k)} className="h-14 rounded-xl border border-gray-200 bg-white text-[20px] font-semibold text-gray-900 flex items-center justify-center active:bg-gray-100 font-mono">{k}</button>
          ))}
          <button onClick={() => onKey('0')} className="col-span-2 h-14 rounded-xl border border-gray-200 bg-white text-[20px] font-semibold text-gray-900 flex items-center justify-center active:bg-gray-100 font-mono">0</button>
          <button onClick={() => onKey('.')} className="h-14 rounded-xl border border-gray-200 bg-white text-[20px] font-semibold text-gray-900 flex items-center justify-center active:bg-gray-100 font-mono">.</button>
        </div>
        <button onClick={onConfirm} className="w-full py-4 rounded-2xl bg-green-600 text-white text-[15px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">Confirm</button>
      </div>
    </div>
  );
}

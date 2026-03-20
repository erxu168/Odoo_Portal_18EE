'use client';

import React from 'react';

/**
 * Standard numpad component for all portal modules.
 * Layout (3-col grid):
 *   [C (accent, span 2)] [Delete]
 *   [1] [2] [3]
 *   [4] [5] [6]
 *   [7] [8] [9]
 *   [0 (span 2)]        [.]
 *   [Confirm (full width)]
 *
 * Usage:
 *   <Numpad open={true} value="5" label="Sesame Oil" sublabel="kg"
 *     onKey={k => ...} onConfirm={() => ...} onClose={() => ...} />
 */
interface NumpadProps {
  open: boolean;
  value: string;
  label?: string;
  sublabel?: string;
  onKey: (key: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function Numpad({ open, value, label, sublabel, onKey, onConfirm, onClose }: NumpadProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-[100] flex items-end justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-[20px] w-full max-w-lg p-5 pb-7" onClick={e => e.stopPropagation()}>
        {/* Product label */}
        {(label || sublabel) && (
          <div className="text-center pb-2">
            {sublabel && <div className="text-[12px] text-gray-400">{sublabel}</div>}
            {label && <div className="text-[15px] font-bold text-[#1F2933]">{label}</div>}
          </div>
        )}

        {/* Display value */}
        <div className="text-center text-[36px] font-extrabold font-mono text-[#1F2933] pb-4 min-h-[52px]">
          {value || '0'}
        </div>

        {/* Numpad grid */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {/* Top row: C + Delete */}
          <button onClick={() => onKey('C')} className="col-span-2 h-14 rounded-xl bg-orange-100 border border-orange-200 text-orange-600 text-[18px] font-bold flex items-center justify-center active:bg-orange-200">C</button>
          <button onClick={() => onKey('del')} className="h-14 rounded-xl bg-gray-100 border border-gray-200 text-gray-500 text-[15px] font-semibold flex items-center justify-center active:bg-gray-200">Delete</button>

          {/* Number rows: 1-9 */}
          {['1','2','3','4','5','6','7','8','9'].map(k => (
            <button key={k} onClick={() => onKey(k)} className="h-14 rounded-xl border border-gray-200 bg-white text-[20px] font-semibold text-[#1F2933] flex items-center justify-center active:bg-gray-100 font-mono">{k}</button>
          ))}

          {/* Bottom row: 0 (span 2) + decimal */}
          <button onClick={() => onKey('0')} className="col-span-2 h-14 rounded-xl border border-gray-200 bg-white text-[20px] font-semibold text-[#1F2933] flex items-center justify-center active:bg-gray-100 font-mono">0</button>
          <button onClick={() => onKey('.')} className="h-14 rounded-xl border border-gray-200 bg-white text-[20px] font-semibold text-[#1F2933] flex items-center justify-center active:bg-gray-100 font-mono">.</button>
        </div>

        {/* Confirm button */}
        <button onClick={onConfirm} className="w-full py-4 rounded-2xl bg-orange-500 text-white text-[15px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 active:scale-[0.975] transition-all">Confirm</button>
      </div>
    </div>
  );
}

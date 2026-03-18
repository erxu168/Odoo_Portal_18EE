'use client';

import React, { useState } from 'react';

interface NumPadProps {
  /** Current value to display */
  value: string;
  /** Unit label (e.g. "kg", "Units") */
  unit: string;
  /** Product name shown at the top */
  label: string;
  /** Demand/required quantity for the Match button */
  demandQty?: number;
  /** Called when user taps Done */
  onConfirm: (value: number) => void;
  /** Called when user taps outside or Cancel */
  onClose: () => void;
  /** Loading state */
  loading?: boolean;
}

/**
 * NumPad — bottom sheet with large keys for kitchen staff.
 * 64px keys for wet/gloved hands.
 * Includes: 0-9, decimal, Clear (C), Backspace, Match, Done.
 */
export default function NumPad({ value: initialValue, unit, label, demandQty, onConfirm, onClose, loading }: NumPadProps) {
  const [display, setDisplay] = useState(initialValue || '0');

  function handleKey(key: string) {
    if (key === 'C') {
      setDisplay('0');
      return;
    }
    if (key === 'BS') {
      setDisplay((d) => d.length <= 1 ? '0' : d.slice(0, -1));
      return;
    }
    if (key === '.') {
      if (display.includes('.')) return;
      setDisplay((d) => d + '.');
      return;
    }
    if (key === 'MATCH' && demandQty !== undefined) {
      setDisplay(String(demandQty));
      return;
    }
    // Digit
    setDisplay((d) => d === '0' ? key : d + key);
  }

  function handleDone() {
    const num = parseFloat(display) || 0;
    onConfirm(num);
  }

  const keyClass = 'h-16 rounded-2xl text-[20px] font-bold flex items-center justify-center active:scale-95 transition-transform select-none';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />
      {/* Sheet */}
      <div
        className="relative w-full max-w-lg bg-white rounded-t-2xl px-4 pt-5 pb-6"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'numpadUp .2s ease-out' }}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

        {/* Label */}
        <div className="text-[13px] font-semibold text-gray-500 mb-1 px-1">{label}</div>

        {/* Display */}
        <div className="flex items-baseline gap-2 mb-4 px-1">
          <div className="text-[36px] font-bold text-gray-900 tabular-nums font-mono">
            {display}
          </div>
          <div className="text-[16px] text-gray-400 font-semibold">{unit}</div>
        </div>

        {/* Quick buttons */}
        <div className="flex gap-2 mb-3">
          {demandQty !== undefined && demandQty > 0 && (
            <button
              onClick={() => handleKey('MATCH')}
              className="flex-1 h-10 rounded-xl bg-orange-50 border border-orange-200 text-orange-700 text-[13px] font-bold active:scale-95 transition-transform"
            >
              Match ({demandQty})
            </button>
          )}
          <button
            onClick={() => setDisplay('0')}
            className="px-4 h-10 rounded-xl bg-gray-100 text-gray-600 text-[13px] font-bold active:scale-95 transition-transform"
          >
            Clear
          </button>
        </div>

        {/* Key grid */}
        <div className="grid grid-cols-4 gap-2">
          {['7', '8', '9', 'BS'].map((k) => (
            <button
              key={k}
              onClick={() => handleKey(k)}
              className={`${keyClass} ${
                k === 'BS' ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-900 border border-gray-200'
              }`}
            >
              {k === 'BS' ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/>
                  <line x1="18" y1="9" x2="12" y2="15"/>
                  <line x1="12" y1="9" x2="18" y2="15"/>
                </svg>
              ) : k}
            </button>
          ))}
          {['4', '5', '6', 'C'].map((k) => (
            <button
              key={k}
              onClick={() => handleKey(k)}
              className={`${keyClass} ${
                k === 'C' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-gray-900 border border-gray-200'
              }`}
            >
              {k}
            </button>
          ))}
          {['1', '2', '3'].map((k) => (
            <button
              key={k}
              onClick={() => handleKey(k)}
              className={`${keyClass} bg-gray-50 text-gray-900 border border-gray-200`}
            >
              {k}
            </button>
          ))}
          <button
            onClick={handleDone}
            disabled={loading}
            className={`${keyClass} bg-orange-500 text-white shadow-lg shadow-orange-500/30 row-span-2 h-auto disabled:opacity-50`}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Done'
            )}
          </button>
          {['0', '.'].map((k) => (
            <button
              key={k}
              onClick={() => handleKey(k)}
              className={`${keyClass} bg-gray-50 text-gray-900 border border-gray-200 ${k === '0' ? 'col-span-2' : ''}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <style jsx>{`@keyframes numpadUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}

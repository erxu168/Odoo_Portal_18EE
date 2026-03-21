'use client';

import React, { useState, useEffect } from 'react';

/**
 * Numpad — Universal bottom-sheet numpad for the Krawings Portal.
 *
 * Used by: Purchase (order quantities), Manufacturing (component quantities),
 * Inventory (count quantities), and any future module needing numeric input.
 *
 * Layout (3-col grid, per DESIGN_GUIDE.md):
 *   C (span 2)  |  Delete
 *   1  |  2  |  3
 *   4  |  5  |  6
 *   7  |  8  |  9
 *   0 (span 2)  |  .
 *   [Confirm button full width]
 *
 * Two usage modes:
 *   1. Self-managed (Manufacturing): pass initialValue, get parsed number in onConfirm
 *   2. Controlled (Purchase): pass value + onChange, use onConfirm for submit
 */

interface NumpadProps {
  /** Whether the numpad is visible. Default: true */
  open?: boolean;
  /** Initial value when opening (self-managed mode) */
  initialValue?: string;
  /** Controlled value (controlled mode — parent manages state) */
  value?: string;
  /** Called on every key press in controlled mode */
  onChange?: (newValue: string) => void;
  /** Product name shown at top */
  label?: string;
  /** Secondary label (e.g. unit of measure) */
  sublabel?: string;
  /** Unit displayed next to the number (e.g. "kg", "L") */
  unit?: string;
  /** If set, shows a "Match" quick-fill button */
  demandQty?: number;
  /** Confirm button text. Default: "Confirm" */
  confirmLabel?: string;
  /** Loading state disables confirm button */
  loading?: boolean;
  /** Called when user taps Confirm. Receives the parsed numeric value. */
  onConfirm: (value: number) => void;
  /** Called when user taps backdrop or wants to close */
  onClose: () => void;
}

export default function Numpad({
  open = true,
  initialValue,
  value: controlledValue,
  onChange,
  label,
  sublabel,
  unit,
  demandQty,
  confirmLabel = 'Confirm',
  loading = false,
  onConfirm,
  onClose,
}: NumpadProps) {
  // Internal state for self-managed mode
  const [internalValue, setInternalValue] = useState(initialValue || '0');

  // Reset internal value when initialValue changes (e.g. opening for a different product)
  useEffect(() => {
    if (initialValue !== undefined) setInternalValue(initialValue || '0');
  }, [initialValue]);

  // Determine which value to display
  const isControlled = controlledValue !== undefined && onChange !== undefined;
  const display = isControlled ? (controlledValue || '0') : internalValue;

  function applyKey(key: string): string {
    if (key === 'C') return '0';
    if (key === 'del' || key === 'BS') {
      return display.length <= 1 ? '0' : display.slice(0, -1);
    }
    if (key === '.') {
      return display.includes('.') ? display : display + '.';
    }
    if (key === 'MATCH' && demandQty !== undefined) {
      return String(demandQty);
    }
    // Digit
    return display === '0' ? key : display + key;
  }

  function handleKey(key: string) {
    const newVal = applyKey(key);
    if (isControlled) {
      onChange!(newVal);
    } else {
      setInternalValue(newVal);
    }
  }

  function handleConfirm() {
    const num = parseFloat(display) || 0;
    onConfirm(num);
  }

  if (!open) return null;

  const keyClass = 'h-14 rounded-xl text-[20px] font-semibold font-mono flex items-center justify-center select-none active:scale-95 transition-transform';

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Sheet */}
      <div
        className="relative w-full max-w-lg bg-white rounded-t-2xl px-4 pt-4 pb-6"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'numpadSlideUp .2s ease-out' }}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />

        {/* Labels */}
        {(label || sublabel) && (
          <div className="px-1 mb-1">
            {sublabel && <div className="text-[12px] text-gray-400">{sublabel}</div>}
            {label && <div className="text-[14px] font-bold text-[#1F2933]">{label}</div>}
          </div>
        )}

        {/* Display */}
        <div className="flex items-baseline gap-2 px-1 mb-3">
          <div className="text-[36px] font-bold text-[#1F2933] tabular-nums font-mono min-h-[48px]">
            {display}
          </div>
          {unit && <div className="text-[16px] text-gray-400 font-semibold">{unit}</div>}
        </div>

        {/* Quick actions */}
        {demandQty !== undefined && demandQty > 0 && (
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => handleKey('MATCH')}
              className="flex-1 h-10 rounded-xl bg-green-50 border border-green-200 text-green-800 text-[13px] font-bold active:scale-95 transition-transform"
            >
              Match ({demandQty})
            </button>
            <button
              onClick={() => handleKey('C')}
              className="px-4 h-10 rounded-xl bg-gray-100 text-gray-600 text-[13px] font-bold active:scale-95 transition-transform"
            >
              Clear
            </button>
          </div>
        )}

        {/* Key grid — 3 columns */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {/* Row 1: C (span 2) | Delete */}
          <button
            onClick={() => handleKey('C')}
            className="col-span-2 h-14 rounded-xl bg-green-50 border border-green-200 text-green-700 text-[18px] font-bold flex items-center justify-center active:bg-green-100 active:scale-95 transition-transform select-none"
          >
            C
          </button>
          <button
            onClick={() => handleKey('del')}
            className="h-14 rounded-xl bg-gray-100 border border-gray-200 text-gray-500 flex items-center justify-center active:bg-gray-200 active:scale-95 transition-transform select-none"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/>
              <line x1="18" y1="9" x2="12" y2="15"/>
              <line x1="12" y1="9" x2="18" y2="15"/>
            </svg>
          </button>

          {/* Rows 2-4: digits 1-9 */}
          {['1','2','3','4','5','6','7','8','9'].map(k => (
            <button
              key={k}
              onClick={() => handleKey(k)}
              className={`${keyClass} border border-gray-200 bg-white text-[#1F2933] active:bg-gray-100`}
            >
              {k}
            </button>
          ))}

          {/* Row 5: 0 (span 2) | decimal */}
          <button
            onClick={() => handleKey('0')}
            className={`${keyClass} col-span-2 border border-gray-200 bg-white text-[#1F2933] active:bg-gray-100`}
          >
            0
          </button>
          <button
            onClick={() => handleKey('.')}
            className={`${keyClass} border border-gray-200 bg-white text-[#1F2933] active:bg-gray-100`}
          >
            .
          </button>
        </div>

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="w-full py-4 rounded-2xl bg-green-600 text-white text-[15px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          ) : (
            confirmLabel
          )}
        </button>
      </div>

      <style>{`@keyframes numpadSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}

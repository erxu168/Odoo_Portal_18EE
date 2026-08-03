'use client';

import React from 'react';
import { applyKey, displayText, validate, type NumericRules, type NumpadKey } from '@/lib/numeric-input';

/**
 * NumpadCore — the keypad itself, with no sheet, no backdrop and no opinion
 * about where it appears.
 *
 * Spec: docs/superpowers/specs/2026-08-03-android-keyboard-numpad-design.md
 *
 * It is deliberately presentation-only and controlled: the caller owns the
 * buffer string. That is what lets three different shells (the portal-wide
 * ui/NumpadProvider, the legacy ui/Numpad modal, and the counting
 * inventory/NumpadModal with its own product header and Nothing-here button)
 * share ONE set of key semantics instead of the three subtly different ones
 * this codebase grew.
 *
 * `layout` exists for the same reason: counting's grid (1-9, ., 0, del with a
 * separate Clear) and Purchase's grid (C, del on top) are both real, staff know
 * them, and neither is worth retraining. The keys behave identically either way.
 */

export type NumpadLayout =
  /** C (wide) + delete on top, then 1-9, then 0 (wide) + decimal. The Purchase/Manufacturing grid. */
  | 'clear-top'
  /** 1-9, then decimal, 0, delete — Clear lives outside the grid. The counting grid. */
  | 'compact';

export interface NumpadCoreProps {
  /** The raw buffer. '' means blank, which is NOT zero. */
  buffer: string;
  onBufferChange: (next: string) => void;
  rules: NumericRules;
  layout?: NumpadLayout;
  /** Unit shown beside the digits (kg, €, h). */
  unit?: string;
  /** Hide the big value readout when the shell draws its own (counting does). */
  hideDisplay?: boolean;
  /** Extra content between the readout and the keys — tolerance hints, quick fills. */
  children?: React.ReactNode;
  className?: string;
}

const KEY_BASE =
  'h-14 rounded-xl text-[20px] font-semibold font-mono flex items-center justify-center select-none active:scale-95 transition-transform';
const KEY_DIGIT = `${KEY_BASE} border border-gray-200 bg-white text-gray-900 active:bg-gray-100`;

function DeleteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  );
}

export default function NumpadCore({
  buffer,
  onBufferChange,
  rules,
  layout = 'clear-top',
  unit,
  hideDisplay = false,
  children,
  className = '',
}: NumpadCoreProps) {
  const { reason } = validate(buffer, rules);
  const isBlank = buffer === '';
  const showDecimal = rules.mode === 'decimal' && rules.fractionDigits !== 0;

  function press(key: NumpadKey) {
    onBufferChange(applyKey(buffer, key, rules));
  }

  const digitKeys: NumpadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className={className}>
      {!hideDisplay && (
        <div className="flex items-baseline gap-2 px-1 mb-3">
          <div
            className={`text-[36px] font-bold tabular-nums font-mono min-h-[48px] ${isBlank ? 'text-gray-300' : 'text-gray-900'}`}
            // Screen readers announce the value as it is typed; a blank field is
            // announced as blank rather than as the dimmed placeholder zero.
            aria-live="polite"
            aria-label={isBlank ? 'No value entered' : `${buffer}${unit ? ` ${unit}` : ''}`}
          >
            {displayText(buffer)}
          </div>
          {unit && <div className="text-[16px] text-gray-400 font-semibold">{unit}</div>}
        </div>
      )}

      {children}

      {reason && !isBlank && (
        <div className="px-2 py-2 rounded-lg mb-2 text-[12px] font-semibold bg-red-50 border border-red-200 text-red-700">
          {reason}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {layout === 'clear-top' && (
          <>
            <button
              type="button"
              onClick={() => press('clear')}
              className="col-span-2 h-14 rounded-xl bg-green-50 border border-green-200 text-green-700 text-[18px] font-bold flex items-center justify-center active:bg-green-100 active:scale-95 transition-transform select-none"
            >
              C
            </button>
            <button
              type="button"
              onClick={() => press('del')}
              aria-label="Delete last digit"
              className="h-14 rounded-xl bg-gray-100 border border-gray-200 text-gray-500 flex items-center justify-center active:bg-gray-200 active:scale-95 transition-transform select-none"
            >
              <DeleteIcon />
            </button>
          </>
        )}

        {digitKeys.map((k) => (
          <button type="button" key={k} onClick={() => press(k)} className={KEY_DIGIT}>
            {k}
          </button>
        ))}

        {layout === 'clear-top' ? (
          <>
            <button type="button" onClick={() => press('0')} className={`${KEY_DIGIT} ${showDecimal ? 'col-span-2' : 'col-span-3'}`}>
              0
            </button>
            {showDecimal && (
              <button type="button" onClick={() => press('.')} className={KEY_DIGIT} aria-label="Decimal point">
                .
              </button>
            )}
          </>
        ) : (
          <>
            {showDecimal ? (
              <button type="button" onClick={() => press('.')} className={KEY_DIGIT} aria-label="Decimal point">
                .
              </button>
            ) : (
              <div aria-hidden="true" />
            )}
            <button type="button" onClick={() => press('0')} className={KEY_DIGIT}>
              0
            </button>
            <button
              type="button"
              onClick={() => press('del')}
              aria-label="Delete last digit"
              className={`${KEY_BASE} bg-gray-100 text-gray-600 active:bg-gray-200`}
            >
              <DeleteIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

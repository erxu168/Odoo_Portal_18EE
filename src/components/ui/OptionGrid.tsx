'use client';

import React from 'react';

/**
 * Big-target option grid — the portal's glove-friendly replacement for radios,
 * toggles and small selects. Selected option fills solid green.
 *
 * Promoted to ui/ in wave 0 from shift-handover/common.tsx.
 */
export interface OptionGridOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface OptionGridProps<T extends string | number> {
  value: T | null | undefined;
  options: Array<OptionGridOption<T>>;
  onChange: (value: T) => void;
  cols?: 2 | 3 | 4 | 5;
  ariaLabel?: string;
}

export function OptionGrid<T extends string | number>({ value, options, onChange, cols = 2, ariaLabel }: OptionGridProps<T>) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            disabled={o.disabled}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[48px] px-3 py-2.5 rounded-xl text-[var(--fs-sm)] font-semibold border transition-colors active:scale-[0.98] ${
              active
                ? 'bg-green-600 text-white border-green-600 shadow-sm'
                : o.disabled
                  ? 'bg-gray-50 text-gray-300 border-gray-100 line-through'
                  : 'bg-white text-gray-700 border-gray-200 active:bg-gray-50'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default OptionGrid;

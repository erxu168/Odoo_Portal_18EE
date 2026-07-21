'use client';

import React from 'react';

/**
 * Touch-friendly styled native select with a soft-gray fill and a thin-line
 * chevron. Promoted to ui/ in wave 0 from shift-handover/common.tsx.
 */
export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'> {
  value: string | number | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

const CHEVRON =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>\")";

export function Select({ value, onChange, options, placeholder, className = '', ...rest }: SelectProps) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] text-gray-900 outline-none focus:border-green-600 appearance-none ${className}`}
      style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
      {...rest}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default Select;

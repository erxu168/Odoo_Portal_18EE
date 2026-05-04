'use client';

import React from 'react';

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}

export default function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-green-500 transition-colors mb-3">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-[var(--fs-base)] text-gray-900 placeholder-gray-400"
      />
      {value && (
        <button onClick={() => onChange('')} className="text-gray-400 text-[18px]" aria-label="Clear search">
          &times;
        </button>
      )}
    </div>
  );
}

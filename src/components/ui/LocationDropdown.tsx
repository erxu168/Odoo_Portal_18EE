'use client';

import React, { useState, useRef, useEffect } from 'react';

// ─────────────────────────────────────────────
// LocationDropdown — Odoo-style location switcher
// Renders as a compact dropdown in the dark header.
// Reusable across all portal modules.
// ─────────────────────────────────────────────

export interface Location {
  id: number;
  name: string;
}

interface LocationDropdownProps {
  locations: Location[];
  selectedId: number;
  onChange: (id: number) => void;
  /** 'dark' for inside the navy header, 'light' for white bg areas */
  variant?: 'dark' | 'light';
}

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const MapPinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export default function LocationDropdown({
  locations,
  selectedId,
  onChange,
  variant = 'dark',
}: LocationDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = locations.find((l) => l.id === selectedId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const isDark = variant === 'dark';

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
          isDark
            ? 'bg-white/10 border border-white/10 text-white/80 active:bg-white/20'
            : 'bg-gray-100 border border-gray-200 text-gray-700 active:bg-gray-200'
        }`}
      >
        <span className={isDark ? 'text-green-400' : 'text-green-600'}>
          <MapPinIcon />
        </span>
        <span>{selected?.name || 'Location'}</span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''} ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
          <ChevronDown />
        </span>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          className={`absolute right-0 top-full mt-1.5 z-[60] min-w-[160px] rounded-xl border shadow-lg overflow-hidden ${
            isDark
              ? 'bg-[#1F2937] border-white/10'
              : 'bg-white border-gray-200'
          }`}
        >
          <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${
            isDark ? 'text-white/30' : 'text-gray-400'
          }`}>
            Location
          </div>
          {locations.map((loc) => {
            const isSelected = loc.id === selectedId;
            return (
              <button
                key={loc.id}
                onClick={() => {
                  onChange(loc.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${
                  isDark
                    ? isSelected
                      ? 'bg-green-600/15 text-green-400'
                      : 'text-white/70 active:bg-white/5'
                    : isSelected
                      ? 'bg-green-50 text-green-700'
                      : 'text-gray-700 active:bg-gray-50'
                }`}
              >
                <span className="flex-1">{loc.name}</span>
                {isSelected && (
                  <span className={isDark ? 'text-green-400' : 'text-green-600'}>
                    <CheckIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

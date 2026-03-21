'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';

/**
 * Compact company selector for the bottom nav bar.
 * Shows current company abbreviation + name. Tap to switch.
 * Always visible so user knows which company is active.
 */
export default function CompanySelector() {
  const { companies, current, companyId, setCompanyId, loading } = useCompany();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (loading) {
    return (
      <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 border border-gray-200 text-[11px] font-bold text-gray-400">
        <div className="w-3 h-3 border border-gray-300 border-t-orange-500 rounded-full animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 text-[11px] font-bold text-red-500">
        No companies
      </div>
    );
  }

  const shortName = current?.warehouse_code || current?.name?.split(' ')[0] || '...';
  const hasMultiple = companies.length > 1;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => hasMultiple && setOpen(!open)}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 border border-gray-200 text-[11px] font-bold text-gray-700 transition-colors ${hasMultiple ? 'active:bg-gray-200' : ''}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F5800A" strokeWidth="2.5" strokeLinecap="round">
          <path d="M3 21h18M3 7v14M21 7v14M7 7V3h10v4M9 21v-4h6v4" />
        </svg>
        <span className="max-w-[100px] truncate">{shortName}</span>
        {hasMultiple && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {open && hasMultiple && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-[70] min-w-[240px] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Switch company</div>
          {companies.map(c => {
            const isSelected = c.id === companyId;
            return (
              <button
                key={c.id}
                onClick={() => { setCompanyId(c.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${
                  isSelected ? 'bg-orange-50 text-orange-600' : 'text-gray-700 active:bg-gray-50'
                }`}
              >
                <span className="flex-1 truncate">{c.name}</span>
                {c.warehouse_code && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{c.warehouse_code}</span>}
                {isSelected && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F5800A" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { useCompany } from '@/lib/company-context';
import { Sheet } from './common';

/**
 * The in-module restaurant indicator/switcher (mock-approved 2026-07-21).
 *
 * Shift Handover runs full-screen and hides the portal's normal company picker,
 * so this pill sits in the module's AppHeader on every screen:
 *  - one allowed restaurant  → a quiet, non-tappable label (staff case);
 *  - several                 → a tappable pill opening a bottom-sheet picker.
 * Switching uses the SHARED portal selection (kw_company_id via useCompany), so
 * Inventory / Purchase etc. follow along — one source of truth.
 */
export function CompanyPill({ onSwitched }: { onSwitched: () => void }) {
  const { companies, companyId, companyName, setCompanyId } = useCompany();
  const [open, setOpen] = useState(false);

  // Company list unavailable (e.g. not loaded yet) — render nothing; the module
  // still resolves the company server-side.
  if (!companyName) return null;

  if (companies.length <= 1) {
    return (
      <span className="text-white/80 text-[var(--fs-xs)] font-semibold px-1 max-w-[110px] truncate">
        {companyName}
      </span>
    );
  }

  function pick(id: number) {
    setOpen(false);
    if (id !== companyId) {
      setCompanyId(id); // writes the shared kw_company_id cookie
      onSwitched();
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-white/15 border border-white/20 rounded-full px-3 h-10 text-white text-[var(--fs-xs)] font-semibold max-w-[140px] active:bg-white/25"
        title="Switch restaurant"
      >
        <span className="truncate">{companyName}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="flex-shrink-0 opacity-75"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <Sheet title="Which restaurant?" onClose={() => setOpen(false)}>
          <p className="text-[var(--fs-sm)] text-gray-500 mb-3">The whole module switches to the one you pick.</p>
          <div className="flex flex-col gap-2 pb-2">
            {companies.map((c) => {
              const active = c.id === companyId;
              return (
                <button
                  key={c.id}
                  onClick={() => pick(c.id)}
                  className={`flex items-center gap-2 min-h-[48px] px-3.5 rounded-xl border text-left text-[var(--fs-sm)] font-semibold active:scale-[0.99] transition-transform ${
                    active ? 'border-green-600 bg-green-50 text-green-900' : 'border-gray-200 bg-white text-gray-700 active:bg-gray-50'
                  }`}
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  {active && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  )}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </>
  );
}

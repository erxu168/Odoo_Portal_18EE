'use client';

import React, { useState } from 'react';
import { useCompany } from '@/lib/company-context';
import { BottomSheet } from './BottomSheet';
import { ChevronDownIcon, CheckIcon } from './ChromeIcons';

/**
 * The in-header restaurant indicator / switcher — part of the portal design
 * standard. Sits in an AppHeader's `action` slot on every module.
 *
 *  - one allowed restaurant  → a quiet, non-tappable label (staff case);
 *  - several                 → a tappable pill opening a bottom-sheet picker.
 *
 * Switching writes the SHARED portal selection (kw_company_id via useCompany), so
 * every module follows along — one source of truth. `onSwitched` fires AFTER the
 * shared selection changes (callers typically reload the screen's data).
 *
 * Promoted to ui/ in wave 0 from shift-handover/CompanyPill.tsx.
 */
export interface CompanyPillProps {
  onSwitched?: (companyId: number) => void;
}

export function CompanyPill({ onSwitched }: CompanyPillProps) {
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
      onSwitched?.(id);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-white/15 border border-white/20 rounded-full px-3 h-10 text-white text-[var(--fs-xs)] font-semibold max-w-[140px] active:bg-white/25"
        aria-label={companyName}
        aria-haspopup="dialog"
      >
        <span className="truncate">{companyName}</span>
        <ChevronDownIcon size={10} className="flex-shrink-0 opacity-75" />
      </button>

      {open && (
        <BottomSheet title="Which restaurant?" onClose={() => setOpen(false)}>
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
                  {active && <CheckIcon size={16} className="text-green-600" />}
                </button>
              );
            })}
          </div>
        </BottomSheet>
      )}
    </>
  );
}

export default CompanyPill;

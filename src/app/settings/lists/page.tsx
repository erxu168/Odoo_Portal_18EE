'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ManagedListSheet from '@/components/ui/ManagedListSheet';
import { useCompany } from '@/lib/company-context';
import { MANAGED_LISTS, type ManagedListDef } from '@/lib/managed-lists/registry';

/**
 * Lists & Options — the one place to review and manage every editable dropdown
 * list. Built straight from the registry, so a new managed list appears here
 * automatically. Each card opens the SAME editor used inline next to the
 * dropdown itself, so behaviour never drifts. Per-restaurant lists use the
 * active company; global lists apply everywhere.
 */
const MODULES: { key: ManagedListDef['module']; label: string }[] = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'purchase', label: 'Purchasing' },
  { key: 'hr', label: 'Team' },
];

export default function ListsSettingsPage() {
  const router = useRouter();
  const { companyId } = useCompany();
  const [active, setActive] = useState<ManagedListDef | null>(null);
  // Managing lists is a manager/admin concern — gate the page itself (the API
  // enforces writes regardless, but staff shouldn't land on this screen).
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      const role = d?.user?.role;
      setAllowed(role === 'manager' || role === 'admin');
    }).catch(() => setAllowed(false));
  }, []);

  // Render the manager UI ONLY once the role check confirms access — while it's
  // pending (null) show a neutral loading state, never the lists.
  if (allowed !== true) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Lists & Options" showBack onBack={() => router.back()} />
        {allowed === false
          ? <p className="text-center text-gray-500 mt-16 px-8">This screen is for managers. Ask a manager to change these lists.</p>
          : <p className="text-center text-gray-400 mt-16">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <AppHeader title="Lists & Options" subtitle="Manage the editable dropdown lists" showBack onBack={() => router.back()} />

      <div className="px-4 py-4 space-y-6">
        {MODULES.map((mod) => {
          const lists = MANAGED_LISTS.filter((d) => d.module === mod.key);
          if (lists.length === 0) return null;
          return (
            <div key={mod.key}>
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2 px-1">{mod.label}</h2>
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {lists.map((d, i) => (
                  <button key={d.key} onClick={() => setActive(d)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-gray-50 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-900">{d.label}</div>
                      <div className="text-[13px] text-gray-500 truncate">{d.description}</div>
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md ${
                      d.scope === 'global' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                    }`}>
                      {d.scope === 'global' ? 'All restaurants' : 'Per restaurant'}
                    </span>
                    <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <p className="text-[12px] text-gray-400 px-1 leading-relaxed">
          These are the lists you can customise. Fixed lists — like weekdays, order statuses and payroll fields — aren&rsquo;t shown here on purpose, because changing them would affect how the system calculates and files things.
        </p>
      </div>

      {active && (
        <ManagedListSheet
          listKey={active.key}
          companyId={active.scope === 'company' ? (companyId ?? undefined) : undefined}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

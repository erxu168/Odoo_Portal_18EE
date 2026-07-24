'use client';

import React, { useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ManagedListSheet from '@/components/ui/ManagedListSheet';
import { useCompany } from '@/lib/company-context';
import { MANAGED_LISTS, type ManagedListDef } from '@/lib/managed-lists/registry';

/**
 * Per-module Settings — the editable dropdown lists that belong to ONE module,
 * built straight from the registry (a new managed list for this module appears
 * here automatically). Each row opens the SAME ManagedListSheet used inline next
 * to the dropdown itself, so behaviour never drifts (one canonical editor).
 *
 * This replaces the old cross-module "Lists & Options" card: settings now live
 * inside the module they configure. Mounted only for managers by the module's
 * Settings entry; the API enforces writes regardless of who reaches the screen.
 */
export default function ModuleListsSettings({ module, title = 'Settings', onBack }: {
  module: ManagedListDef['module'];
  title?: string;
  onBack: () => void;
}) {
  const { companyId } = useCompany();
  const [active, setActive] = useState<ManagedListDef | null>(null);
  const lists = MANAGED_LISTS.filter((d) => d.module === module);

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <AppHeader title={title} subtitle="Manage the editable dropdown lists" showBack onBack={onBack} />

      <div className="px-4 py-4 space-y-4">
        {lists.length === 0 ? (
          <p className="text-center text-gray-400 mt-10 px-8">There are no editable lists for this module yet.</p>
        ) : (
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
        )}

        <p className="text-[12px] text-gray-400 px-1 leading-relaxed">
          These are the lists you can customise. Fixed lists — like weekdays and order statuses — aren&rsquo;t shown, because changing them would affect how the system calculates and files things.
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

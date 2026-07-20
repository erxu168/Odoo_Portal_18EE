'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, EmptyState, FilterBar, FilterPill } from '@/components/inventory/ui';
import { ContainerCard, type ContainerView } from './ContainerCard';
import { ContainerSheet } from './ContainerSheet';
import { apiGet, type FlatLocation } from './common';

interface Cfg { container_types: Array<{ id: number; name: string }>; locations: FlatLocation[]; }
interface Group { key: string; label: string; containers: ContainerView[] }
type Filter = 'all' | 'ready_for_service' | 'backup_stock' | 'use_first';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ready_for_service', label: 'Ready' },
  { id: 'backup_stock', label: 'Backup' },
  { id: 'use_first', label: 'Use first' },
];

export function StorageOverview({ cfg, companyPill, canEdit, onBack }: { cfg: Cfg; companyPill?: React.ReactNode; canEdit: boolean; onBack: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [editId, setEditId] = useState<number | null>(null);

  const load = useCallback(() => {
    const qs = filter === 'all' ? '' : filter === 'use_first' ? '?use_first=1' : `?availability=${filter}`;
    apiGet(`/api/shift-handover/containers${qs}`).then((d: any) => setGroups(d.groups || [])).catch(() => setGroups([]));
  }, [filter]);
  useEffect(load, [load]);

  const total = groups?.reduce((n, g) => n + g.containers.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader supertitle="SHIFT HANDOVER" title="Storage overview" subtitle={`${total} active container${total !== 1 ? 's' : ''}`} showBack onBack={onBack} action={companyPill} />
      <div className="pt-3">
        <FilterBar>
          {FILTERS.map((f) => <FilterPill key={f.id} active={filter === f.id} label={f.label} onClick={() => setFilter(f.id)} />)}
        </FilterBar>
      </div>

      <div className="flex-1 px-4 py-2">
        {groups === null ? <Spinner /> : total === 0 ? (
          <EmptyState icon="🧊" title="Nothing in storage" body="Recorded containers appear here, grouped by where they’re stored." />
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="flex items-center gap-1.5 px-1 mb-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  <h3 className="text-[var(--fs-sm)] font-bold text-gray-700">{g.label}</h3>
                  <span className="text-[var(--fs-xs)] text-gray-400">· {g.containers.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {g.containers.map((c) => <ContainerCard key={c.id} c={c} onTap={canEdit ? () => setEditId(c.id) : undefined} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editId != null && (
        <ContainerSheet containerId={editId} cfg={cfg} canEdit={canEdit} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load(); }} />
      )}
    </div>
  );
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, EmptyState } from '@/components/inventory/ui';
import { ContainerCard, type ContainerView } from './ContainerCard';
import { ContainerSheet } from './ContainerSheet';
import { Chip, apiGet, type FlatLocation } from './common';

interface Cfg { container_types: Array<{ id: number; name: string }>; locations: FlatLocation[]; }
interface Batch {
  id: number; product_name: string; produced_by_name: string | null; produced_at: string;
  shift_label: string | null; active_count: number; outstanding_actions: number; containers: ContainerView[];
}

export function CurrentProduction({ cfg, operationalDate, companyPill, canEdit, onBack, onRecord }: {
  cfg: Cfg; operationalDate: string; companyPill?: React.ReactNode; canEdit: boolean; onBack: () => void; onRecord: () => void;
}) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const load = useCallback(() => {
    apiGet(`/api/shift-handover/batches?date=${operationalDate}`).then((d: any) => setBatches(d.batches || [])).catch(() => setBatches([]));
  }, [operationalDate]);
  useEffect(load, [load]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader supertitle="SHIFT HANDOVER" title="Current production" subtitle={operationalDate} showBack onBack={onBack}
        action={
          <div className="flex items-center gap-1.5">
            {companyPill}
            {canEdit && <button onClick={onRecord} className="bg-white/15 text-white text-[var(--fs-sm)] font-semibold rounded-xl px-3 h-10 active:bg-white/25">+ Record</button>}
          </div>
        } />

      <div className="flex-1 px-4 py-4">
        {batches === null ? <Spinner /> : batches.length === 0 ? (
          <EmptyState icon="🍗" title="No production recorded yet" body="Tap Record to log what the kitchen has produced this shift." />
        ) : (
          <div className="flex flex-col gap-4">
            {batches.map((b) => (
              <div key={b.id} className="bg-white border border-gray-200 rounded-2xl p-3.5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[var(--fs-lg)] font-bold text-gray-900">{b.product_name}</h3>
                  <div className="flex gap-1.5">
                    {b.shift_label && <Chip tone="confirmed">{b.shift_label}</Chip>}
                    {b.outstanding_actions > 0 && <Chip tone="due_soon">{b.outstanding_actions} to-do</Chip>}
                  </div>
                </div>
                <p className="text-[var(--fs-xs)] text-gray-400 mb-3">
                  {b.active_count} active container{b.active_count !== 1 ? 's' : ''}
                  {b.produced_by_name ? ` · by ${b.produced_by_name}` : ''}
                  {b.produced_at ? ` · ${new Date(b.produced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                </p>
                <div className="flex flex-col gap-2">
                  {b.containers.map((c) => (
                    <ContainerCard key={c.id} c={c} onTap={canEdit ? () => setEditId(c.id) : undefined} />
                  ))}
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

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, EmptyState, FilterBar, FilterPill } from '@/components/inventory/ui';
import { Chip, apiGet } from './common';
import { HANDOVER_STATUS_LABELS, HANDOVER_STATUS_BADGE } from '@/lib/shift-handover/labels';

const ACTION_TEXT: Record<string, string> = {
  'batch.recorded': 'recorded a production batch',
  'batch.containers_added': 'added containers to a batch',
  'container.updated': 'updated a container',
  'container.photo_added': 'added a container photo',
  'photo.replaced': 'replaced a photo',
  'action.created': 'created a task',
  'action.completed': 'completed a task',
  'action.updated': 'updated a task',
  'handover.submitted': 'submitted a handover',
  'handover.acknowledged': 'acknowledged a handover',
  'discrepancy.reported': 'reported a discrepancy',
  'discrepancy.resolved': 'resolved a discrepancy',
};

export function History({ canViewAudit, onBack, onOpenHandover }: {
  canViewAudit: boolean; onBack: () => void; onOpenHandover: (id: number) => void;
}) {
  const [tab, setTab] = useState<'handovers' | 'activity'>('handovers');
  const [handovers, setHandovers] = useState<any[] | null>(null);
  const [events, setEvents] = useState<any[] | null>(null);

  const load = useCallback(() => {
    apiGet('/api/shift-handover/handovers?limit=50').then((d: any) => setHandovers(d.handovers || [])).catch(() => setHandovers([]));
    if (canViewAudit) apiGet('/api/shift-handover/events?limit=100').then((d: any) => setEvents(d.events || [])).catch(() => setEvents([]));
  }, [canViewAudit]);
  useEffect(load, [load]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader supertitle="SHIFT HANDOVER" title="History" subtitle="Handovers & audit trail" showBack onBack={onBack} />
      <div className="pt-3">
        <FilterBar>
          <FilterPill active={tab === 'handovers'} label="Handovers" onClick={() => setTab('handovers')} />
          {canViewAudit && <FilterPill active={tab === 'activity'} label="Activity log" onClick={() => setTab('activity')} />}
        </FilterBar>
      </div>

      <div className="flex-1 px-4 py-2">
        {tab === 'handovers' ? (
          handovers === null ? <Spinner /> : handovers.length === 0 ? (
            <EmptyState icon="📋" title="No handovers yet" body="Submitted handovers are listed here." />
          ) : (
            <div className="flex flex-col gap-2">
              {handovers.map((h) => (
                <button key={h.id} onClick={() => onOpenHandover(h.id)} className="w-full text-left bg-white border border-gray-200 rounded-xl p-3 active:bg-gray-50 flex items-center justify-between">
                  <div>
                    <div className="text-[var(--fs-sm)] font-semibold text-gray-900">{h.operational_date}{h.outgoing_shift_label ? ` · ${h.outgoing_shift_label}` : ''}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400">{h.submitted_by_name ? `by ${h.submitted_by_name}` : 'draft'}{h.submitted_at ? ` · ${new Date(h.submitted_at).toLocaleDateString()}` : ''}</div>
                  </div>
                  <Chip tone={HANDOVER_STATUS_BADGE[h.status] || 'draft'}>{HANDOVER_STATUS_LABELS[h.status] || h.status}</Chip>
                </button>
              ))}
            </div>
          )
        ) : (
          events === null ? <Spinner /> : events.length === 0 ? (
            <EmptyState icon="🧾" title="No activity yet" body="Every change is recorded here — who, what and when." />
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {events.map((e) => (
                <div key={e.id} className="px-4 py-3 border-b border-gray-100 last:border-0">
                  <p className="text-[var(--fs-sm)] text-gray-800">
                    <span className="font-semibold">{e.actor_name || 'Someone'}</span> {ACTION_TEXT[e.action] || e.action}
                  </p>
                  <p className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{new Date(e.created_at).toLocaleString()}{e.operational_date ? ` · ${e.operational_date}` : ''}</p>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

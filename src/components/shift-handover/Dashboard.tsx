'use client';

import React from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';

export interface Overview {
  batches_today: number; active_containers: number; open_actions: number; critical_actions: number;
  use_first: number; on_hold: number; pending_handovers: number;
}

interface Tile { id: string; label: string; sub: string; icon: string; badge?: number; danger?: boolean }

export function Dashboard({ overview, operationalDate, headerAction, can, onOpen }: {
  overview: Overview | null; operationalDate: string; headerAction?: React.ReactNode; can: (screen: string) => boolean; onOpen: (screen: string) => void;
}) {
  const o = overview;
  const tiles: Tile[] = [
    { id: 'record', label: 'Record production', sub: 'Log a new batch', icon: '🍗' },
    { id: 'current', label: 'Current production', sub: `${o?.batches_today ?? 0} batches today`, icon: '📋', badge: o?.batches_today },
    { id: 'storage', label: 'Storage overview', sub: `${o?.active_containers ?? 0} containers`, icon: '🧊', badge: o?.active_containers },
    { id: 'handover', label: 'Shift handover', sub: o?.pending_handovers ? `${o.pending_handovers} awaiting ack` : 'Review & submit', icon: '🔄', badge: o?.pending_handovers, danger: !!o?.pending_handovers },
    { id: 'tasks', label: 'Tasks', sub: o?.critical_actions ? `${o.critical_actions} critical` : `${o?.open_actions ?? 0} open`, icon: '✅', badge: o?.open_actions, danger: !!o?.critical_actions },
    { id: 'history', label: 'History', sub: 'Handovers & audit', icon: '🧾' },
    { id: 'config', label: 'Configuration', sub: 'Products & storage', icon: '⚙️' },
  ];
  const visible = tiles.filter((t) => can(t.id));

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="INVENTORY" title="Shift Handover" subtitle={operationalDate} action={headerAction} />
      <div className="px-4 py-4">
        {o && (
          <KpiRow columns={4} className="mb-4">
            <KpiChip value={o.active_containers} label="In storage" />
            <KpiChip value={o.use_first} label="Use first" />
            <KpiChip value={o.open_actions} label="Tasks" tone={o.critical_actions ? 'danger' : 'default'} />
            <KpiChip value={o.on_hold} label="On hold" tone={o.on_hold ? 'danger' : 'default'} />
          </KpiRow>
        )}
        <ActionGrid
          items={visible}
          getItemId={(t) => t.id}
          renderItem={(t) => (
            <ActionCard
              emoji={t.icon}
              label={t.label}
              subtitle={t.sub}
              onClick={() => onOpen(t.id)}
              badge={t.badge ? { value: t.badge, tone: t.danger ? 'danger' : 'count' } : undefined}
            />
          )}
        />
      </div>
    </div>
  );
}

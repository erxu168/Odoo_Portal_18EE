'use client';

import React from 'react';
import AppHeader from '@/components/ui/AppHeader';

export interface Overview {
  batches_today: number; active_containers: number; open_actions: number; critical_actions: number;
  use_first: number; on_hold: number; pending_handovers: number;
}

interface Tile { id: string; label: string; sub: string; icon: string; badge?: number; danger?: boolean }

export function Dashboard({ overview, operationalDate, can, onOpen }: {
  overview: Overview | null; operationalDate: string; can: (screen: string) => boolean; onOpen: (screen: string) => void;
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
      <AppHeader supertitle="INVENTORY" title="Shift Handover" subtitle={operationalDate} />
      <div className="px-4 py-4">
        {o && (
          <div className="grid grid-cols-4 gap-2 mb-4">
            <Kpi n={o.active_containers} label="In storage" />
            <Kpi n={o.use_first} label="Use first" />
            <Kpi n={o.open_actions} label="Tasks" danger={!!o.critical_actions} />
            <Kpi n={o.on_hold} label="On hold" danger={!!o.on_hold} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {visible.map((t) => (
            <button key={t.id} onClick={() => onOpen(t.id)} className="relative bg-white rounded-2xl border border-gray-200 p-4 text-left active:scale-[0.97] transition-transform min-h-[104px] flex flex-col">
              <div className="w-11 h-11 rounded-xl bg-[#F1F3F5] flex items-center justify-center text-2xl mb-2">{t.icon}</div>
              <div className="text-[var(--fs-base)] font-bold text-gray-900 leading-tight">{t.label}</div>
              <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{t.sub}</div>
              {!!t.badge && t.badge > 0 && (
                <span className={`absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full text-white text-[var(--fs-xs)] font-bold flex items-center justify-center ${t.danger ? 'bg-red-500' : 'bg-green-600'}`}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ n, label, danger }: { n: number; label: string; danger?: boolean }) {
  return (
    <div className="rounded-xl bg-white border border-gray-200 py-2.5 text-center">
      <div className={`text-[var(--fs-xl)] font-bold ${danger && n > 0 ? 'text-red-600' : 'text-gray-900'}`}>{n}</div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}

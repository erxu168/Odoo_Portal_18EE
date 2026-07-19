'use client';

/**
 * Employee lifecycle journey — a card on the employee page showing their checklists
 * (Joined → Promoted → Leaving) with progress, plus a manual "Start checklist" action.
 * Self-contained (loads its own data), mounted inside EmployeeDetail like the access card.
 */
import React, { useCallback, useEffect, useState } from 'react';
import StartChecklistPrompt from './StartChecklistPrompt';
import { LEVEL_LABEL } from './ChecklistSetup';
import type { InstanceRow, Stage } from '@/types/staffing';

interface InstanceWithCounts extends InstanceRow { total: number; done: number }

const STAGE_ICON: Record<Stage, string> = { joining: '🌱', promotion: '⬆️', leaving: '🚪' };

export default function EmployeeJourney({ employeeId, onOpenChecklist }: {
  employeeId: number;
  onOpenChecklist: (instanceId: number) => void;
}) {
  const [rows, setRows] = useState<InstanceWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [allowed, setAllowed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staffing/checklists?employee_id=${employeeId}`);
      if (res.status === 403) { setAllowed(false); return; }
      const d = await res.json();
      setRows(d.instances || []);
    } catch { /* empty */ }
    finally { setLoading(false); }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  if (!allowed) return null;

  // Chronological (oldest first) for the journey.
  const ordered = [...rows].reverse();

  function label(r: InstanceWithCounts): string {
    if (r.stage === 'promotion') return `Promoted → ${LEVEL_LABEL[r.target_level || ''] || r.target_level}`;
    if (r.stage === 'leaving') return `Leaving${r.department_name ? ' · ' + r.department_name : ''}`;
    return `Joined${r.department_name ? ' · ' + r.department_name : ''}`;
  }

  return (
    <div className="bg-white border-t border-b border-gray-200 mt-2">
      <div className="px-5 py-3 flex items-center justify-between">
        <span className="text-[13px] font-extrabold uppercase tracking-wider text-gray-500">Lifecycle checklists</span>
        <button onClick={() => setStarting(true)} className="text-[13px] font-bold text-[#C2410C]">+ Start</button>
      </div>

      {loading ? (
        <div className="px-5 pb-4 text-[13px] text-gray-400">Loading…</div>
      ) : ordered.length === 0 ? (
        <div className="px-5 pb-4 text-[13px] text-gray-500">No checklists yet. Tap Start to begin one.</div>
      ) : (
        <div className="px-5 pb-4 space-y-2">
          {ordered.map(r => {
            const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
            return (
              <button key={r.id} onClick={() => onOpenChecklist(r.id)}
                className="w-full flex items-center gap-3 rounded-2xl border border-gray-200 p-3 text-left active:scale-[0.99] transition-transform">
                <span className="text-xl">{STAGE_ICON[r.stage]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-bold text-gray-900 truncate">{label(r)}</span>
                    <span className={`text-[11px] font-bold ${r.status === 'done' ? 'text-green-700' : r.status === 'cancelled' ? 'text-red-600' : 'text-gray-500'}`}>
                      {r.status === 'done' ? 'Done' : r.status === 'cancelled' ? 'Cancelled' : `${r.done}/${r.total}`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden mt-1.5">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {starting && (
        <StartChecklistPrompt
          employeeId={employeeId}
          onStarted={(id) => { setStarting(false); load(); onOpenChecklist(id); }}
          onClose={() => setStarting(false)}
        />
      )}
    </div>
  );
}

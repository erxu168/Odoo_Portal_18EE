'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, EmptyState } from '@/components/inventory/ui';
import { Chip, OptionGrid, Field, PrimaryButton, ErrorNote, Sheet, apiGet, apiSend, useAsync } from './common';
import { PRIORITY_LABELS, PRIORITY_BADGE } from '@/lib/shift-handover/labels';
import { ACTION_PRIORITIES } from '@/lib/shift-handover/states';

interface Action { id: number; instruction: string; priority: string; status: string; due_at: string | null; }

export function Tasks({ operationalDate, canCreate, canManageCritical, onBack }: {
  operationalDate: string; canCreate: boolean; canManageCritical: boolean; onBack: () => void;
}) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const { busy, run, error, setError } = useAsync();

  const load = useCallback(() => {
    apiGet('/api/shift-handover/actions?open=1').then((d: any) => setActions(d.actions || [])).catch(() => setActions([]));
  }, []);
  useEffect(load, [load]);

  async function complete(a: Action) {
    setError(null);
    const res = await run(() => apiSend(`/api/shift-handover/actions/${a.id}/complete`, 'POST', {}));
    if (res) load();
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader supertitle="SHIFT HANDOVER" title="Tasks" subtitle="Open next-actions" showBack onBack={onBack}
        action={canCreate ? <button onClick={() => setShowAdd(true)} className="bg-white/15 text-white text-[var(--fs-sm)] font-semibold rounded-xl px-3 h-10 active:bg-white/25">+ Task</button> : undefined} />
      <div className="flex-1 px-4 py-4">
        <ErrorNote>{error}</ErrorNote>
        {actions === null ? <Spinner /> : actions.length === 0 ? (
          <EmptyState icon="✅" title="No open tasks" body="Next-actions from production and handovers show up here." />
        ) : (
          <div className="flex flex-col gap-2">
            {actions.map((a) => (
              <div key={a.id} className="bg-white border border-gray-200 rounded-2xl p-3.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1"><Chip tone={PRIORITY_BADGE[a.priority] || 'draft'}>{PRIORITY_LABELS[a.priority] || a.priority}</Chip>{a.status === 'in_progress' && <Chip tone="progress">In progress</Chip>}</div>
                  <p className="text-[var(--fs-base)] text-gray-900">{a.instruction}</p>
                  {a.due_at && <p className="text-[var(--fs-xs)] text-gray-400 mt-0.5">Due {new Date(a.due_at).toLocaleString()}</p>}
                </div>
                {(a.priority !== 'food_safety_critical' || canManageCritical) && (
                  <button onClick={() => complete(a)} disabled={busy} className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-green-500 text-green-600 flex items-center justify-center active:bg-green-50 disabled:opacity-50" aria-label="Mark done">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {showAdd && <AddTaskSheet operationalDate={operationalDate} canManageCritical={canManageCritical} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddTaskSheet({ operationalDate, canManageCritical, onClose, onAdded }: {
  operationalDate: string; canManageCritical: boolean; onClose: () => void; onAdded: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [priority, setPriority] = useState('normal');
  const { busy, error, run } = useAsync();
  const priorities = ACTION_PRIORITIES.filter((p) => p !== 'food_safety_critical' || canManageCritical);

  async function add() {
    const res = await run(() => apiSend('/api/shift-handover/actions', 'POST', { instruction, priority, operational_date: operationalDate }));
    if (res) onAdded();
  }

  return (
    <Sheet title="New task" onClose={onClose} footer={<PrimaryButton onClick={add} busy={busy} disabled={!instruction.trim()}>Add task</PrimaryButton>}>
      <ErrorNote>{error}</ErrorNote>
      <Field label="What needs to happen?">
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Move container A to the countertop fridge before 17:00" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 min-h-[72px] outline-none focus:border-green-600" />
      </Field>
      <Field label="Priority">
        <OptionGrid cols={2} value={priority} options={priorities.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={setPriority} />
      </Field>
    </Sheet>
  );
}

'use client';

/**
 * A person's checklist for one stage — two sections (Business / Employee), tick as
 * you go, deadline badges (overdue red / due-soon amber). Managers tick anything;
 * an employee can tick their own Employee tasks (enforced server-side).
 */
import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { berlinToday } from '@/lib/berlin-date';
import { dueState } from '@/lib/staffing-logic';
import type { InstanceRow, InstanceTaskRow, Audience } from '@/types/staffing';
import { LEVEL_LABEL } from './ChecklistSetup';

const STAGE_TITLE: Record<string, string> = { joining: 'Joining', promotion: 'Promotion', leaving: 'Leaving' };

export default function EmployeeChecklistView({ instanceId, onBack }: {
  instanceId: number; onBack: () => void;
}) {
  const [instance, setInstance] = useState<InstanceRow | null>(null);
  const [tasks, setTasks] = useState<InstanceTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const today = berlinToday();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staffing/checklists/${instanceId}`);
      const d = await res.json();
      if (res.ok) { setInstance(d.instance); setTasks(d.tasks || []); }
    } catch { /* empty */ }
    finally { setLoading(false); }
  }, [instanceId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(task: InstanceTaskRow) {
    const next = task.status === 'pending' ? 'done' : 'pending';
    setSavingId(task.id);
    // Optimistic.
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: next } : t));
    try {
      const res = await fetch(`/api/staffing/checklists/${instanceId}/tasks/${task.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Revert on failure.
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: task.status } : t));
    } finally { setSavingId(null); }
  }

  const total = tasks.length;
  const done = tasks.filter(t => t.status !== 'pending').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const title = instance
    ? (instance.stage === 'promotion'
        ? `→ ${LEVEL_LABEL[instance.target_level || ''] || instance.target_level}`
        : `${STAGE_TITLE[instance.stage]}${instance.department_name ? ' · ' + instance.department_name : ''}`)
    : 'Checklist';

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle={instance ? STAGE_TITLE[instance.stage].toUpperCase() : ''} title={title} showBack onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="p-5 space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-[15px] font-extrabold text-gray-900">{done} of {total} done</span>
              {instance?.status === 'cancelled' && <span className="text-[11px] font-bold text-red-600">Cancelled</span>}
              {instance?.status === 'done' && <span className="text-[11px] font-bold text-green-700">Complete</span>}
            </div>
            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
              <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <ChecklistSection title="Business tasks" audience="business" tasks={tasks} today={today} savingId={savingId} onToggle={toggle} />
          <ChecklistSection title="Employee tasks" audience="employee" tasks={tasks} today={today} savingId={savingId} onToggle={toggle} />
        </div>
      )}
    </div>
  );
}

function ChecklistSection({ title, audience, tasks, today, savingId, onToggle }: {
  title: string; audience: Audience; tasks: InstanceTaskRow[]; today: string;
  savingId: number | null; onToggle: (t: InstanceTaskRow) => void;
}) {
  const rows = tasks.filter(t => t.audience === audience);
  const doneN = rows.filter(t => t.status !== 'pending').length;
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-gray-500 mb-2 px-1">
        {title} <span className="text-gray-400">· {doneN} of {rows.length}</span>
      </h2>
      <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
        {rows.map(t => (
          <TaskRow key={t.id} task={t} today={today} saving={savingId === t.id} onToggle={() => onToggle(t)} />
        ))}
      </div>
    </section>
  );
}

function TaskRow({ task, today, saving, onToggle }: { task: InstanceTaskRow; today: string; saving: boolean; onToggle: () => void }) {
  const state = dueState({ status: task.status, dueDate: task.due_date, todayISO: today });
  const done = task.status !== 'pending';
  return (
    <button onClick={onToggle} disabled={saving} className="w-full flex items-center gap-3 p-3.5 text-left disabled:opacity-60">
      <span className={`w-6 h-6 rounded-full grid place-items-center flex-shrink-0 border-2 ${
        done ? 'bg-green-600 border-green-600 text-white' : state === 'overdue' ? 'border-red-400' : 'border-gray-300'
      }`}>{done ? '✓' : ''}</span>
      <div className="flex-1 min-w-0">
        <div className={`text-[14px] ${done ? 'line-through text-gray-400 font-medium' : 'font-semibold text-gray-900'}`}>{task.title}</div>
        {task.due_date && !done && (
          <div className="mt-1">
            {state === 'overdue' && <Badge cls="bg-red-100 text-red-800">Overdue</Badge>}
            {state === 'due_soon' && <Badge cls="bg-amber-100 text-amber-800">Due {task.due_date}</Badge>}
            {(state === 'upcoming' || state === 'none') && <Badge cls="bg-blue-50 text-blue-700">Due {task.due_date}</Badge>}
            {task.reminder === 1 && <span className="ml-1.5 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-bold">🔔</span>}
          </div>
        )}
      </div>
    </button>
  );
}

function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{children}</span>;
}

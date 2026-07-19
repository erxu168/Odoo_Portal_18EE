'use client';

/**
 * The signed-in employee's own lifecycle tasks (joining / promotion / leaving),
 * shown on their HR dashboard. Tickable in place — the employee marks their own
 * Employee-section tasks done (allowed server-side). Renders nothing when empty.
 */
import React, { useEffect, useState } from 'react';
import { berlinToday } from '@/lib/berlin-date';
import { dueState } from '@/lib/staffing-logic';

interface MyTask {
  id: number; instance_id: number; title: string;
  due_date: string | null; reminder: number; stage: string;
}

export default function MyLifecycleTasks() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const today = berlinToday();

  useEffect(() => {
    fetch('/api/staffing/my-tasks').then(r => r.json())
      .then(d => setTasks(d.tasks || []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function done(t: MyTask) {
    setSavingId(t.id);
    try {
      const res = await fetch(`/api/staffing/checklists/${t.instance_id}/tasks/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
      });
      if (res.ok) setTasks(ts => ts.filter(x => x.id !== t.id));
    } catch { /* keep it in the list */ }
    finally { setSavingId(null); }
  }

  if (!loaded || tasks.length === 0) return null;

  return (
    <div className="mx-5 mt-4 rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
      <div className="px-4 py-2.5 text-[13px] font-extrabold uppercase tracking-wider text-amber-800">
        Your tasks · {tasks.length} to do
      </div>
      <div className="bg-white divide-y divide-gray-100">
        {tasks.map(t => {
          const state = dueState({ status: 'pending', dueDate: t.due_date, todayISO: today });
          return (
            <button key={t.id} onClick={() => done(t)} disabled={savingId === t.id}
              className="w-full flex items-center gap-3 p-3.5 text-left disabled:opacity-60">
              <span className={`w-6 h-6 rounded-full border-2 flex-shrink-0 ${state === 'overdue' ? 'border-red-400' : 'border-gray-300'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-gray-900">{t.title}</div>
                {t.due_date && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      state === 'overdue' ? 'bg-red-100 text-red-800' : state === 'due_soon' ? 'bg-amber-100 text-amber-800' : 'bg-blue-50 text-blue-700'
                    }`}>{state === 'overdue' ? 'Overdue' : `Due ${t.due_date}`}</span>
                    {t.reminder === 1 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-bold">🔔</span>}
                  </div>
                )}
              </div>
              <span className="text-[12px] font-semibold text-green-700">Done</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

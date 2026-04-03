'use client';

import { useState, useEffect } from 'react';
import { Shift, ShiftTaskList, getTaskListForShift } from '@/lib/odoo-tasks';
import ShiftPill from '../_components/ShiftPill';
import ChecklistCard from '../_components/ChecklistCard';
import BottomNav from '../_components/BottomNav';

export default function StaffPage() {
  const [shifts, setShifts]           = useState<Shift[]>([]);
  const [selectedShift, setSelected]  = useState<Shift | null>(null);
  const [taskList, setTaskList]       = useState<ShiftTaskList | null>(null);
  const [loading, setLoading]         = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/tasks/shifts')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setShifts(d.shifts ?? []);
      })
      .catch(() => setError('Could not load shifts'))
      .finally(() => setLoading(false));
  }, []);

  async function selectShift(shift: Shift) {
    setSelected(shift);
    setListLoading(true);
    try {
      // Task list fetch is client-side since getTaskListForShift uses stubs
      // Once real API exists, swap this for: fetch(`/api/tasks/list/${shift.id}`)
      const list = await getTaskListForShift(shift);
      setTaskList(list);
    } finally {
      setListLoading(false);
    }
  }

  async function handleComplete(taskLineId: number) {
    const res  = await fetch(`/api/tasks/${taskLineId}/complete`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) { alert(data.error || 'Failed to complete task'); return; }
    // Optimistic update
    setTaskList(prev => {
      if (!prev) return prev;
      const lines = prev.task_lines.map(t =>
        t.id === taskLineId
          ? { ...t, state: 'done' as const, completed_at: new Date().toISOString(), completed_by_name: 'You' }
          : t
      );
      const done = lines.filter(t => t.state === 'done').length;
      return { ...prev, task_lines: lines, completion_rate: Math.round(done / lines.length * 100) };
    });
  }

  async function handleSubtaskToggle(taskLineId: number, subtaskId: number, done: boolean) {
    if (!selectedShift) return;
    await fetch(`/api/tasks/${selectedShift.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_subtask', task_line_id: taskLineId, subtask_id: subtaskId, done }),
    });
  }

  async function handlePhotoUpload(taskLineId: number) {
    // TODO: open file picker → POST to /api/tasks/[id]/photo
    console.log('photo upload for task', taskLineId);
  }

  const today    = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 max-w-[430px] mx-auto">
      {/* Top bar */}
      <div className="bg-orange-500 px-5 pt-5 pb-4 flex-shrink-0">
        <p className="text-orange-100 text-xs font-medium">{today}</p>
        <p className="text-white text-lg font-bold mt-0.5">{greeting} 👋</p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">

        {selectedShift && (
          <button
            onClick={() => { setSelected(null); setTaskList(null); }}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 mb-3 hover:text-orange-500 transition-colors"
          >
            ← Back to shifts
          </button>
        )}

        {!selectedShift && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">Today&apos;s shifts</p>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm mb-3">{error}</div>
            )}
            {loading ? (
              <div className="space-y-2">
                {[1,2].map(i => <div key={i} className="h-16 bg-gray-200 rounded-2xl animate-pulse" />)}
              </div>
            ) : shifts.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-3xl mb-2">📋</p>
                <p className="font-semibold">No shifts today</p>
                <p className="text-sm mt-1">Check back later or contact your manager</p>
              </div>
            ) : (
              shifts.map(shift => (
                <ShiftPill
                  key={shift.id}
                  shift={shift}
                  selected={selectedShift?.id === shift.id}
                  onClick={() => selectShift(shift)}
                />
              ))
            )}
          </>
        )}

        {selectedShift && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">
              {selectedShift.name} — Task List
            </p>
            {listLoading ? (
              <div className="h-48 bg-gray-200 rounded-2xl animate-pulse" />
            ) : taskList ? (
              <ChecklistCard
                taskList={taskList}
                onComplete={handleComplete}
                onSubtaskToggle={handleSubtaskToggle}
                onPhotoUpload={handlePhotoUpload}
              />
            ) : (
              <div className="text-center py-12 text-gray-400">
                <p className="text-3xl mb-2">📋</p>
                <p className="font-semibold">No checklist assigned</p>
                <p className="text-sm mt-1">Ask your manager to assign a task list to this shift</p>
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

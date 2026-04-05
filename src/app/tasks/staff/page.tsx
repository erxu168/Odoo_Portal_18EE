'use client';

import { useState, useEffect } from 'react';
import type { Shift, ShiftTaskList } from '@/lib/odoo-tasks';
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
  const [seeding, setSeeding]         = useState(false);
  const [seedLog, setSeedLog]         = useState<string[] | null>(null);

  function loadShifts() {
    setLoading(true);
    setError(null);
    fetch('/api/tasks/shifts')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setShifts(d.shifts ?? []);
      })
      .catch(() => setError('Could not load shifts'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadShifts(); }, []);

  async function handleSeed() {
    setSeeding(true);
    setSeedLog(null);
    try {
      const res  = await fetch('/api/tasks/seed', { method: 'POST' });
      const data = await res.json();
      setSeedLog(data.log ?? ['Done']);
      // Reload shifts after seeding
      loadShifts();
    } catch {
      setSeedLog(['Failed to seed test data']);
    } finally {
      setSeeding(false);
    }
  }

  async function handleCleanup() {
    await fetch('/api/tasks/seed', { method: 'DELETE' });
    setSeedLog(null);
    loadShifts();
  }

  async function selectShift(shift: Shift) {
    setSelected(shift);
    setListLoading(true);
    setTaskList(null);
    try {
      const res  = await fetch(`/api/tasks/list/${shift.id}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTaskList(data.taskList ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load task list');
    } finally {
      setListLoading(false);
    }
  }

  async function handleComplete(taskLineId: number) {
    const res  = await fetch(`/api/tasks/${taskLineId}/complete`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) { alert(data.error || 'Failed to complete task'); return; }
    setTaskList(prev => {
      if (!prev) return prev;
      const lines = prev.task_lines.map(t =>
        t.id === taskLineId
          ? { ...t, state: 'done' as const, completed_at: new Date().toISOString(), completed_by_name: 'You' }
          : t,
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

  async function handlePhotoUpload(_taskLineId: number) {
    throw new Error('Photo upload is not yet available');
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
                {[1, 2].map(i => <div key={i} className="h-16 bg-gray-200 rounded-2xl animate-pulse" />)}
              </div>
            ) : shifts.length === 0 ? (
              <>
                <div className="text-center py-8 text-gray-400">
                  <p className="text-3xl mb-2">📋</p>
                  <p className="font-semibold">No shifts today</p>
                  <p className="text-sm mt-1">Check back later or contact your manager</p>
                </div>

                {/* ── Test Data Banner ── */}
                <div className="mt-4 border border-dashed border-orange-300 rounded-2xl p-4 bg-orange-50">
                  <p className="text-xs font-bold text-orange-600 uppercase tracking-wide mb-1">🧪 Test mode</p>
                  <p className="text-xs text-orange-700 mb-3">
                    No shifts found. Click below to inject test data into Odoo and link your account to a test employee.
                  </p>
                  <button
                    onClick={handleSeed}
                    disabled={seeding}
                    className="w-full bg-orange-500 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-orange-600 transition-colors disabled:opacity-60"
                  >
                    {seeding ? '⏳ Setting up test data...' : '⚡ Load test data for today'}
                  </button>
                  {seedLog && (
                    <div className="mt-3 space-y-1">
                      {seedLog.map((line, i) => (
                        <p key={i} className="text-xs text-orange-800 font-mono">{line}</p>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {shifts.map(shift => (
                  <ShiftPill
                    key={shift.id}
                    shift={shift}
                    selected={selectedShift !== null && (selectedShift as Shift).id === shift.id}
                    onClick={() => selectShift(shift)}
                  />
                ))}
                {/* Cleanup button shown when test data exists */}
                <button
                  onClick={handleCleanup}
                  className="mt-3 w-full text-xs text-gray-400 underline text-center"
                >
                  Remove test data
                </button>
              </>
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

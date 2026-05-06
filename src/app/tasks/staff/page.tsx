'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TaskList, EmployeeContext } from '@/lib/odoo-tasks';
import ChecklistCard from '../_components/ChecklistCard';
import BottomNav from '../_components/BottomNav';
import AdHocModal, { type AdHocSubmitVals } from '../_components/AdHocModal';
import { uploadTaskPhoto } from '../_components/photoUpload';
import Toast from '@/components/ui/Toast';
import { useToast } from '../_components/useToast';

interface TodayResponse {
  context: EmployeeContext | null;
  list: TaskList | null;
  error?: string;
  code?: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

type Role = 'staff' | 'manager' | 'admin';

export default function StaffPage() {
  const [data,    setData]    = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [role,    setRole]    = useState<Role>('staff');
  const [date,    setDate]    = useState<string>(todayStr());
  const [showAdd, setShowAdd] = useState(false);
  const [creating, setCreating] = useState(false);
  // Track whether we're on the client. Time-dependent values (todayLabel,
  // greeting) and the date picker default must be computed only after mount,
  // because the SSR pass runs in the server's UTC timezone while the phone is
  // in Europe/Berlin — without this gate, React throws hydration errors
  // (#418/#423/#425) that can interfere with the role-detection useEffect and
  // hide the admin controls entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const today    = todayStr();
  const isToday  = date === today;
  const isPast   = date < today;
  const isFuture = date > today;
  const isManagerOrAdmin = role === 'manager' || role === 'admin';
  const { toast, showToast, dismissToast } = useToast();

  // Fetch user role once on mount
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.role) setRole(d.user.role);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // First fetch context (employee → department) via /today; then if a different
      // date is selected and user is manager/admin, swap the list with history.
      const ctxRes = await fetch('/api/tasks/today');
      const ctxBody = await ctxRes.json();
      if (!ctxRes.ok) {
        setError(ctxBody.error || 'Failed to load list');
        setData(ctxBody);
        return;
      }
      if (isToday) {
        setData(ctxBody);
        return;
      }
      if (!isManagerOrAdmin) {
        // staff can only see today
        setData(ctxBody);
        return;
      }
      // manager/admin viewing past or future: fetch via history endpoint
      const deptId = ctxBody.context?.department_id;
      if (!deptId) {
        setData(ctxBody);
        return;
      }
      const histRes = await fetch(`/api/tasks/manager/history?dept=${deptId}&date=${date}`);
      const histBody = await histRes.json();
      setData({ context: ctxBody.context, list: histBody.list ?? null });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [date, isToday, isManagerOrAdmin]);

  useEffect(() => { load(); }, [load]);

  async function handleComplete(lineId: number) {
    const res = await fetch(`/api/tasks/lines/${lineId}/complete`, { method: 'POST' });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Failed to complete');
    await load();
    showToast('Task completed');
  }

  async function handleSubtaskToggle(_lineId: number, subtaskId: number, done: boolean) {
    const res = await fetch(`/api/tasks/lines/${_lineId}/subtasks/${subtaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to toggle subtask');
    }
  }

  async function handlePhotoUpload(lineId: number) {
    return uploadTaskPhoto(lineId, load);
  }

  async function ensureList(): Promise<number | null> {
    const ctx = data?.context;
    if (!ctx?.department_id) throw new Error('No department on your account');
    if (data?.list) return data.list.id;
    const res = await fetch('/api/tasks/list/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department_id: ctx.department_id, date }),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Failed to create list');
    return body.list_id;
  }

  async function handleCreateList() {
    setCreating(true);
    try {
      await ensureList();
      await load();
      showToast('List created');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleAdd(vals: AdHocSubmitVals) {
    let listId = data?.list?.id;
    if (!listId) listId = (await ensureList()) ?? undefined;
    if (!listId) throw new Error('No list available');
    const res = await fetch(`/api/tasks/list/${listId}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vals),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Failed to add task');
    setShowAdd(false);
    await load();
    showToast('Task added');
  }

  // Server renders these as empty strings; client fills them in after mount.
  const todayLabel = mounted
    ? new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';
  const greeting   = mounted
    ? (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })()
    : '';
  const list = data?.list ?? null;
  const ctx  = data?.context ?? null;
  const showManagerControls = isManagerOrAdmin && !!ctx?.department_id;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 max-w-[430px] mx-auto">
      <div className="bg-orange-500 px-5 pt-5 pb-4 flex-shrink-0">
        <p className="text-orange-100 text-xs font-medium">{todayLabel}</p>
        <p className="text-white text-lg font-bold mt-0.5">{greeting} 👋</p>
        {ctx?.department_name && (
          <p className="text-orange-100 text-sm mt-0.5">{ctx.department_name}</p>
        )}
      </div>

      {showManagerControls && (
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 flex-1 min-w-0"
          />
          {!isToday && (
            <button
              onClick={() => setDate(today)}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700 px-2 flex-shrink-0"
            >
              Today
            </button>
          )}
          {!isPast && (
            <button
              onClick={() => setShowAdd(true)}
              disabled={!ctx?.department_id}
              className="bg-orange-500 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-orange-600 disabled:opacity-50 flex-shrink-0"
            >
              + Add
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">
        {showManagerControls && isPast && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-700 text-xs mb-4">
            📖 Read-only history.
          </div>
        )}
        {showManagerControls && isFuture && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-xs mb-4">
            🗓️ Scheduled day — add one-off tasks here. They&apos;ll appear when staff opens this date&apos;s list.
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-200 rounded-2xl animate-pulse" />)}
          </div>
        ) : error ? (
          <EmptyState
            emoji="⚠️"
            title={data?.code === 'NO_DEPARTMENT' ? 'No department' : data?.code === 'NO_EMPLOYEE' ? 'No employee record' : 'Could not load'}
            message={error}
          />
        ) : !list ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="font-semibold text-gray-600">No list for {date}</p>
            <p className="text-sm mt-1 max-w-xs mx-auto">
              {isToday
                ? `No checklist has been published for ${ctx?.department_name ?? 'your department'} today.`
                : `No list exists for ${ctx?.department_name ?? 'this department'} on this date.`}
            </p>
            {showManagerControls && !isPast && (
              <button
                onClick={handleCreateList}
                disabled={creating}
                className="mt-4 bg-orange-500 text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {creating ? 'Creating…' : `Create list for ${date}`}
              </button>
            )}
          </div>
        ) : list.lines.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">📝</p>
            <p className="font-semibold text-gray-600">Empty list</p>
            <p className="text-sm mt-1">{isToday ? "Today's list has no tasks yet." : 'This list has no tasks yet.'}</p>
            {showManagerControls && !isPast && (
              <button
                onClick={() => setShowAdd(true)}
                className="mt-4 bg-orange-500 text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-orange-600"
              >
                + Add first task
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {isToday ? "Today's tasks" : `Tasks for ${date}`}
              </p>
              <p className="text-xs font-semibold text-gray-500">
                {list.completed_count} / {list.line_count} done · {list.completion_rate}%
              </p>
            </div>
            <ChecklistCard
              taskList={list}
              onComplete={handleComplete}
              onSubtaskToggle={handleSubtaskToggle}
              onPhotoUpload={handlePhotoUpload}
              readOnly={isPast || isFuture}
            />
          </>
        )}
      </div>

      <BottomNav />

      {showAdd && (
        <AdHocModal date={date} onClose={() => setShowAdd(false)} onSubmit={handleAdd} />
      )}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={dismissToast} />}
    </div>
  );
}

function EmptyState({ emoji, title, message }: { emoji: string; title: string; message: string }) {
  return (
    <div className="text-center py-12 text-gray-400">
      <p className="text-3xl mb-2">{emoji}</p>
      <p className="font-semibold text-gray-600">{title}</p>
      <p className="text-sm mt-1 max-w-xs mx-auto">{message}</p>
    </div>
  );
}

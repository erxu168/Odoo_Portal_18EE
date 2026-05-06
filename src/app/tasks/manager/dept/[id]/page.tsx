'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import type { TaskList } from '@/lib/odoo-tasks';
import ChecklistCard from '../../../_components/ChecklistCard';
import AdHocModal, { type AdHocSubmitVals } from '../../../_components/AdHocModal';
import { uploadTaskPhoto } from '../../../_components/photoUpload';
import Toast from '@/components/ui/Toast';
import { useToast } from '../../../_components/useToast';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

export default function DeptReviewPage({ params }: PageProps) {
  // Next 14: params may be sync object; Next 15: thenable. Both compatible with `use`.
  const resolved = (typeof (params as Promise<{ id: string }>).then === 'function')
    ? use(params as Promise<{ id: string }>)
    : (params as { id: string });
  const deptId = parseInt(resolved.id, 10);

  const [date, setDate]       = useState<string>(todayStr());
  const [list, setList]       = useState<TaskList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [creating, setCreating] = useState(false);

  const today = todayStr();
  const isToday = date === today;
  const isPast = date < today;
  const isFuture = date > today;
  const { toast, showToast, dismissToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/tasks/manager/history?dept=${deptId}&date=${date}`);
      const body = await res.json();
      if (!res.ok) setError(body.error || 'Failed');
      else setList(body.list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [deptId, date]);

  useEffect(() => { load(); }, [load]);

  async function handleComplete(lineId: number) {
    const res = await fetch(`/api/tasks/lines/${lineId}/complete`, { method: 'POST' });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Failed');
    await load();
  }

  async function handleSubtaskToggle(lineId: number, subtaskId: number, done: boolean) {
    await fetch(`/api/tasks/lines/${lineId}/subtasks/${subtaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
  }

  async function handlePhotoUpload(lineId: number) {
    return uploadTaskPhoto(lineId, load);
  }

  async function ensureList(): Promise<number | null> {
    // Returns the list id (existing or freshly created), or null on failure.
    if (list) return list.id;
    const res = await fetch('/api/tasks/list/ensure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department_id: deptId, date }),
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
    let listId = list?.id;
    if (!listId) listId = await ensureList() ?? undefined;
    if (!listId) throw new Error('No list available');
    const res = await fetch(`/api/tasks/list/${listId}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vals),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Failed to add task');
    setShowAddModal(false);
    await load();
    showToast('Task added');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
        <Link href="/tasks/manager" className="text-sm text-gray-400 hover:text-orange-500">← Manager</Link>
        <h1 className="font-bold text-gray-800 truncate">{list?.department_name ?? 'Department'}</h1>
        <div className="w-16" />
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex items-center gap-2 mb-4">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          {!isToday && (
            <button
              onClick={() => setDate(today)}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700"
            >
              Today
            </button>
          )}
          {!isPast && list && (
            <button
              onClick={() => setShowAddModal(true)}
              className="ml-auto bg-orange-500 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-orange-600"
            >
              + Add task
            </button>
          )}
        </div>

        {isPast && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-700 text-xs mb-4">
            📖 Read-only history. Use the date picker to view a different day.
          </div>
        )}
        {isFuture && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-xs mb-4">
            🗓️ Scheduled day — add one-off tasks here. They&apos;ll appear when staff opens this date&apos;s list.
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-32 bg-gray-200 rounded-2xl animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">{error}</div>
        ) : !list ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="font-semibold">No list for {date}</p>
            {!isPast && (
              <button
                onClick={handleCreateList}
                disabled={creating}
                className="mt-4 bg-orange-500 text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {creating ? 'Creating…' : `Create list for ${date}`}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {list.template_name ? `Template: ${list.template_name}` : 'Ad-hoc list'}
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

      {showAddModal && (
        <AdHocModal date={date} onClose={() => setShowAddModal(false)} onSubmit={handleAdd} />
      )}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={dismissToast} />}
    </div>
  );
}

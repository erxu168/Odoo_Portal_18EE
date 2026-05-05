'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import type { TaskList, DayPart, ModuleLink } from '@/lib/odoo-tasks';
import ChecklistCard from '../../../_components/ChecklistCard';

const DAY_PART_OPTIONS: { value: DayPart; label: string }[] = [
  { value: 'opening', label: 'Opening' },
  { value: 'mid_day', label: 'Mid-day' },
  { value: 'closing', label: 'Closing' },
];

const MODULE_OPTIONS: { value: ModuleLink; label: string }[] = [
  { value: 'none', label: 'No link' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'pos', label: 'Point of Sale' },
  { value: 'manufacturing', label: 'Manufacturing' },
];

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

  async function handlePhotoUpload(_lineId: number) {
    // Manager review screen doesn't expose photo upload — staff page does.
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
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setCreating(false);
    }
  }

  async function handleAdd(vals: { name: string; day_part: DayPart; deadline_datetime: string | null; photo_required: boolean; module_link_type: ModuleLink }) {
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
    </div>
  );
}

interface ModalProps {
  date: string;
  onClose: () => void;
  onSubmit: (vals: {
    name: string;
    day_part: DayPart;
    deadline_datetime: string | null;
    photo_required: boolean;
    module_link_type: ModuleLink;
  }) => Promise<void>;
}

function AdHocModal({ date, onClose, onSubmit }: ModalProps) {
  const [name, setName]                       = useState('');
  const [dayPart, setDayPart]                 = useState<DayPart>('opening');
  const [deadline, setDeadline]               = useState('');
  const [photoRequired, setPhotoRequired]     = useState(false);
  const [moduleLink, setModuleLink]           = useState<ModuleLink>('none');
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) { setError('Name required'); return; }
    setSubmitting(true); setError(null);
    try {
      let deadlineIso: string | null = null;
      if (deadline) {
        // Combine the picked date + time into local-zone ISO
        deadlineIso = new Date(`${date}T${deadline}:00`).toISOString();
      }
      await onSubmit({
        name: name.trim(),
        day_part: dayPart,
        deadline_datetime: deadlineIso,
        photo_required: photoRequired,
        module_link_type: moduleLink,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800 text-lg mb-4">Add one-off task</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Task name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Deep clean fryer"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Section</label>
              <select value={dayPart} onChange={e => setDayPart(e.target.value as DayPart)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                {DAY_PART_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Deadline</label>
              <input type="time" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Module link</label>
            <select value={moduleLink} onChange={e => setModuleLink(e.target.value as ModuleLink)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
              {MODULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={photoRequired} onChange={e => setPhotoRequired(e.target.checked)} />
            Photo required
          </label>
          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="flex-1 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
            {submitting ? 'Adding…' : 'Add task'}
          </button>
        </div>
      </div>
    </div>
  );
}

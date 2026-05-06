'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import type { TaskTemplate, TaskTemplateLine, DayPart, ModuleLink } from '@/lib/odoo-tasks';

const DAY_PART_OPTIONS: { value: DayPart; label: string }[] = [
  { value: 'opening', label: 'Opening' },
  { value: 'mid_day', label: 'Mid-day' },
  { value: 'closing', label: 'Closing' },
];

const MODULE_OPTIONS: { value: ModuleLink; label: string }[] = [
  { value: 'none', label: 'No link' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'pos', label: 'POS' },
  { value: 'manufacturing', label: 'Manufacturing' },
];

const DAYS = [
  { k: 'mon', l: 'Mon' }, { k: 'tue', l: 'Tue' }, { k: 'wed', l: 'Wed' },
  { k: 'thu', l: 'Thu' }, { k: 'fri', l: 'Fri' }, { k: 'sat', l: 'Sat' },
  { k: 'sun', l: 'Sun' },
] as const;

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

function floatToHHMM(v: number | null | undefined): string {
  if (v == null) return '';
  const h = Math.floor(v);
  const m = Math.round((v - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hhmmToFloat(s: string): number | null {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h + m / 60;
}

export default function TemplateEditPage({ params }: PageProps) {
  const resolved = (typeof (params as Promise<{ id: string }>).then === 'function')
    ? use(params as Promise<{ id: string }>)
    : (params as { id: string });
  const tplId = parseInt(resolved.id, 10);

  const [tpl, setTpl]         = useState<TaskTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [editingLine, setEditingLine] = useState<TaskTemplateLine | null>(null);
  const [showAddLine, setShowAddLine] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/tasks/templates/${tplId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed');
      setTpl(body.template);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [tplId]);

  useEffect(() => { load(); }, [load]);

  async function saveHeader() {
    if (!tpl) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/templates/${tplId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tpl.name, days_of_week: tpl.days_of_week }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed');
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm('Archive this template? Daily spawning will stop. (You can unarchive later.)')) return;
    const res = await fetch(`/api/tasks/templates/${tplId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive' }),
    });
    const body = await res.json();
    if (!body.ok) { alert(body.error || 'Failed'); return; }
    window.location.href = '/tasks/manager/templates';
  }

  async function deleteLine(lineId: number) {
    if (!confirm('Delete this task from the template?')) return;
    const res = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}`, { method: 'DELETE' });
    const body = await res.json();
    if (!body.ok) { alert(body.error || 'Failed'); return; }
    await load();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-4">
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-200 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }
  if (error || !tpl) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-4">
        <Link href="/tasks/manager/templates" className="text-sm text-gray-400">← Templates</Link>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm mt-4">{error || 'Not found'}</div>
      </div>
    );
  }

  const grouped: Record<DayPart, TaskTemplateLine[]> = { opening: [], mid_day: [], closing: [] };
  for (const l of tpl.lines) grouped[l.day_part].push(l);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
        <Link href="/tasks/manager/templates" className="text-sm text-gray-400 hover:text-orange-500">← Templates</Link>
        <h1 className="font-bold text-gray-800 truncate">{tpl.name || 'Template'}</h1>
        <button onClick={archive} className="text-xs font-semibold text-red-500 hover:text-red-600">Archive</button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Settings</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Name</label>
              <input value={tpl.name} onChange={e => setTpl({ ...tpl, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Department</label>
              <p className="text-sm text-gray-700">{tpl.department_name}</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Days of week</label>
              <div className="flex gap-2">
                {DAYS.map(d => (
                  <button key={d.k} type="button"
                    onClick={() => setTpl({ ...tpl, days_of_week: { ...tpl.days_of_week, [d.k]: !tpl.days_of_week[d.k] } })}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold ${
                      tpl.days_of_week[d.k] ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-400'
                    }`}>
                    {d.l}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={saveHeader} disabled={saving}
              className="w-full py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Tasks</p>
            <button onClick={() => setShowAddLine(true)} className="text-sm font-semibold text-orange-600 hover:text-orange-700">
              + Add task
            </button>
          </div>
          <div className="space-y-3">
            {(['opening', 'mid_day', 'closing'] as DayPart[]).map(part => {
              const lines = grouped[part];
              if (lines.length === 0) return null;
              return (
                <div key={part} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  <p className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-200">
                    {DAY_PART_OPTIONS.find(o => o.value === part)?.label}
                  </p>
                  {lines.map((l, i) => (
                    <div key={l.id} className={`px-4 py-3 ${i < lines.length - 1 ? 'border-b border-gray-100' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-gray-800">{l.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {l.deadline_time != null ? `By ${floatToHHMM(l.deadline_time)} · ` : ''}
                            {l.photo_required ? '\u{1F4F8} required · ' : ''}
                            {l.module_link_type !== 'none' ? `${l.module_link_type} · ` : ''}
                            {l.subtasks.length > 0 ? `${l.subtasks.length} subtask${l.subtasks.length === 1 ? '' : 's'}` : 'no subtasks'}
                          </p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => setEditingLine(l)} className="text-xs text-gray-500 hover:text-orange-600 px-2 py-1">Edit</button>
                          <button onClick={() => deleteLine(l.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            {tpl.lines.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
                <p className="text-3xl mb-2">📋</p>
                <p className="font-semibold text-gray-700 text-sm">No tasks yet</p>
                <p className="text-xs text-gray-400 mt-1">Add your first task to start using this template.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {(showAddLine || editingLine) && (
        <LineModal
          tplId={tplId}
          line={editingLine}
          onClose={() => { setShowAddLine(false); setEditingLine(null); }}
          onSaved={async () => { setShowAddLine(false); setEditingLine(null); await load(); }}
        />
      )}
    </div>
  );
}

interface LineModalProps {
  tplId: number;
  line: TaskTemplateLine | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function LineModal({ tplId, line, onClose, onSaved }: LineModalProps) {
  const [name, setName]               = useState(line?.name ?? '');
  const [dayPart, setDayPart]         = useState<DayPart>(line?.day_part ?? 'opening');
  const [deadline, setDeadline]       = useState(floatToHHMM(line?.deadline_time));
  const [photoRequired, setPhotoReq]  = useState(line?.photo_required ?? false);
  const [photoInstructions, setPhotoInstr] = useState(line?.photo_instructions ?? '');
  const [moduleLink, setModuleLink]   = useState<ModuleLink>(line?.module_link_type ?? 'none');
  const [subtasks, setSubtasks]       = useState<{ id?: number; name: string }[]>(
    line?.subtasks.map(s => ({ id: s.id, name: s.name })) ?? [],
  );
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setError('Name required'); return; }
    setSubmitting(true); setError(null);
    try {
      const url = line
        ? `/api/tasks/templates/${tplId}/lines/${line.id}`
        : `/api/tasks/templates/${tplId}/lines`;
      const method = line ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          day_part: dayPart,
          deadline_time: hhmmToFloat(deadline),
          photo_required: photoRequired,
          photo_instructions: photoRequired && photoInstructions.trim() ? photoInstructions.trim() : null,
          module_link_type: moduleLink,
          subtasks: subtasks
            .filter(s => s.name.trim())
            .map((s, i) => ({ id: s.id, name: s.name.trim(), sequence: (i + 1) * 10 })),
        }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed');
      await onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800 text-lg px-5 pt-5 pb-3 flex-shrink-0">{line ? 'Edit task' : 'Add task'}</h2>
        <div className="flex-1 overflow-y-auto px-5 space-y-3 min-h-0">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Inspect restrooms"
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
            <input type="checkbox" checked={photoRequired} onChange={e => setPhotoReq(e.target.checked)} />
            Photo required
          </label>
          {photoRequired && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Photo instructions (optional)</label>
              <textarea
                value={photoInstructions}
                onChange={e => setPhotoInstr(e.target.value)}
                placeholder="e.g. Take picture of the toilet bowl showing the connectors/screws"
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <p className="text-[11px] text-gray-400 mt-1">Shown to staff above the photo upload button.</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Subtasks</label>
            <div className="space-y-1.5">
              {subtasks.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input value={s.name} onChange={e => setSubtasks(prev => prev.map((p, idx) => idx === i ? { ...p, name: e.target.value } : p))}
                    placeholder="Subtask name"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  <button onClick={() => setSubtasks(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-xs text-red-500 hover:text-red-600 px-2">Remove</button>
                </div>
              ))}
              <button onClick={() => setSubtasks(prev => [...prev, { name: '' }])}
                className="text-xs font-semibold text-orange-600 hover:text-orange-700">
                + Add subtask
              </button>
            </div>
          </div>
          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
          <div className="h-2" />
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import ManagerTabs from '../../_components/ManagerTabs';
import Toast from '@/components/ui/Toast';
import { useToast } from '../../_components/useToast';
import type { TaskTemplateSummary, DepartmentOption } from '@/lib/odoo-tasks';

const DAY_LABELS: { key: keyof TaskTemplateSummary['days_of_week']; label: string }[] = [
  { key: 'mon', label: 'M' }, { key: 'tue', label: 'T' }, { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' }, { key: 'fri', label: 'F' }, { key: 'sat', label: 'S' },
  { key: 'sun', label: 'S' },
];

export default function TemplateListPage() {
  const [templates, setTemplates]   = useState<TaskTemplateSummary[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tplRes, deptRes] = await Promise.all([
        fetch(`/api/tasks/templates${showArchived ? '?include_archived=1' : ''}`),
        fetch('/api/tasks/departments'),
      ]);
      const tplBody = await tplRes.json();
      const deptBody = await deptRes.json();
      if (!tplRes.ok) throw new Error(tplBody.error || 'Failed');
      if (!deptRes.ok) throw new Error(deptBody.error || 'Failed');
      setTemplates(tplBody.templates || []);
      setDepartments(deptBody.departments || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
        <Link href="/tasks/manager" className="text-sm text-gray-400 hover:text-orange-500">← Manager</Link>
        <h1 className="font-bold text-gray-800">Templates</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="text-sm font-semibold text-orange-600 hover:text-orange-700"
        >
          + New
        </button>
      </div>

      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-4">
        <label className="flex items-center gap-2 text-sm text-gray-600 mb-3">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-200 rounded-2xl animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">{error}</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="font-semibold">No templates yet</p>
            <p className="text-sm mt-1">Create one to start spawning daily lists.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {templates.map((t, i) => (
              <Link key={t.id} href={`/tasks/manager/templates/${t.id}`}
                className={`flex items-center justify-between px-4 py-3.5 hover:bg-orange-50/30 transition-colors ${i < templates.length - 1 ? 'border-b border-gray-100' : ''} ${!t.active ? 'opacity-60' : ''}`}>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-gray-800 truncate">
                    {t.name}
                    {!t.active && <span className="ml-2 text-xs font-normal text-gray-400">(archived)</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.department_name} · {t.line_count} task{t.line_count === 1 ? '' : 's'}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {DAY_LABELS.map(d => (
                    <span key={d.key} className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${
                      t.days_of_week[d.key] ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-300'
                    }`}>
                      {d.label}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateModal
          departments={departments}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); window.location.href = `/tasks/manager/templates/${id}`; }}
        />
      )}
    </div>
  );
}

function CreateModal({ departments, onClose, onCreated }: {
  departments: DepartmentOption[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [name, setName]     = useState('');
  const [deptId, setDeptId] = useState<number>(departments[0]?.id ?? 0);
  const [days, setDays]     = useState({ mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !deptId) { setError('Name and department required'); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/tasks/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), department_id: deptId, days_of_week: days }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed');
      onCreated(body.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800 text-lg px-5 pt-5 pb-3 flex-shrink-0">New template</h2>
        <div className="flex-1 overflow-y-auto px-5 space-y-3 min-h-0">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kitchen — Standard Day"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Department</label>
            <select value={deptId} onChange={e => setDeptId(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
              {departments.map(d => <option key={d.id} value={d.id}>{d.name} ({d.company_name})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Days of week</label>
            <div className="flex gap-2">
              {([
                { k: 'mon', l: 'Mon' }, { k: 'tue', l: 'Tue' }, { k: 'wed', l: 'Wed' },
                { k: 'thu', l: 'Thu' }, { k: 'fri', l: 'Fri' }, { k: 'sat', l: 'Sat' },
                { k: 'sun', l: 'Sun' },
              ] as const).map(d => (
                <button key={d.k} type="button"
                  onClick={() => setDays(prev => ({ ...prev, [d.k]: !prev[d.k] }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    days[d.k] ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-400'
                  }`}>
                  {d.l}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
          <div className="h-2" />
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

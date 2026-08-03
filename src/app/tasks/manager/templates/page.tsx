'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ManagerTabs from '../../_components/ManagerTabs';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';
import { useToast } from '../../_components/useToast';
import type { TaskTemplateSummary, DepartmentOption } from '@/lib/odoo-tasks';

export default function TemplateListPage() {
  const router = useRouter();
  const { toast, showToast, dismissToast } = useToast();
  const [templates, setTemplates]   = useState<TaskTemplateSummary[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<TaskTemplateSummary | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

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

  async function setArchived(t: TaskTemplateSummary, archived: boolean) {
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/tasks/templates/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: archived ? 'archive' : 'unarchive' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || 'Failed');
      showToast(archived ? 'Template archived.' : 'Template restored.', 'success');
      // Instant view update: drop it (archive, default list) or reload to re-place it.
      if (archived && !showArchived) setTemplates(prev => prev.filter(x => x.id !== t.id));
      else load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        supertitle="TASK MANAGER"
        title="Templates"
        showBack
        onBack={() => router.push('/tasks/manager')}
      />

      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-4">
        <p className="text-sm text-gray-500 mb-3 leading-snug">
          A template is a department&apos;s recurring task list. The daily lists are spawned from the active ones.
        </p>

        {/* Standard primary action — one green button (matches the Guides screen). */}
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full min-h-[48px] mb-3 rounded-xl bg-green-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-green-700 active:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New template
        </button>

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
            <p className="text-sm mt-1">Create one with the button above to start spawning daily lists.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map(t => (
              <div
                key={t.id}
                className={`flex items-stretch bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden ${busyId === t.id ? 'opacity-50' : ''} ${!t.active ? 'opacity-70' : ''}`}
              >
                <Link
                  href={`/tasks/manager/templates/${t.id}`}
                  className="flex-1 min-w-0 px-4 py-3.5 hover:bg-blue-50/40 active:bg-blue-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                >
                  <p className="font-semibold text-sm text-gray-800 truncate">
                    {t.name}
                    {!t.active && <span className="ml-2 text-xs font-normal text-gray-400">(archived)</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.department_name} · {t.line_count} task{t.line_count === 1 ? '' : 's'}</p>
                </Link>
                {t.active ? (
                  <button
                    type="button"
                    onClick={() => setConfirmArchive(t)}
                    disabled={busyId === t.id}
                    aria-label={`Archive template ${t.name}`}
                    title="Archive"
                    className="w-12 flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-red-600 active:text-red-700 border-l border-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 disabled:opacity-50"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setArchived(t, false)}
                    disabled={busyId === t.id}
                    aria-label={`Restore template ${t.name}`}
                    className="px-3 flex-shrink-0 flex items-center justify-center text-xs font-semibold text-blue-600 hover:text-blue-700 border-l border-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 disabled:opacity-50"
                  >
                    Restore
                  </button>
                )}
              </div>
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

      {confirmArchive && (
        <ConfirmDialog
          title="Archive this template?"
          message={`Daily lists will stop being created from “${confirmArchive.name}”. Tasks already spawned are kept, and you can restore it any time from “Show archived”.`}
          confirmLabel="Archive"
          variant="danger"
          onConfirm={() => { const t = confirmArchive; setConfirmArchive(null); setArchived(t, true); }}
          onCancel={() => setConfirmArchive(null)}
        />
      )}

      {toast && <Toast message={toast.msg} type={toast.type} visible onDismiss={dismissToast} />}
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !deptId) { setError('Name and department required'); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/tasks/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), department_id: deptId }),
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
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Department</label>
            <select value={deptId} onChange={e => setDeptId(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              {departments.map(d => <option key={d.id} value={d.id}>{d.name} ({d.company_name})</option>)}
            </select>
          </div>
          <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            💡 You&apos;ll set the schedule (daily / weekly / monthly / one-off) on each task after creating the template.
          </p>
          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
          <div className="h-2" />
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

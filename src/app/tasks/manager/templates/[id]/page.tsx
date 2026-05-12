'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TaskTemplate, TaskTemplateLine, TaskAttachment, TaskList, TaskListLine, DayPart, ModuleLink, RecurrenceRule, DepartmentOption } from '@/lib/odoo-tasks';
import AppHeader from '@/components/ui/AppHeader';
import { useCompany } from '@/lib/company-context';
import AttachmentList from '../../../_components/AttachmentList';
import ChecklistCard from '../../../_components/ChecklistCard';
import RecurrenceEditor from '../../../_components/RecurrenceEditor';
import Toast from '@/components/ui/Toast';
import { useToast } from '../../../_components/useToast';

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

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Inline copy of the default rule — keeping it client-safe (no odoo-tasks runtime import). */
function defaultRecurrence(): RecurrenceRule {
  const today = new Date().toISOString().slice(0, 10);
  return {
    type: 'daily',
    interval: 1,
    start_date: today,
    end_type: 'never',
    end_date: null,
    count: null,
    one_off_date: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    monthly_mode: 'day_of_month',
    day_of_month: 1,
    weekday_pos: 1,
    weekday: 0,
    month: 1,
    exception_dates: [],
  };
}

/**
 * Plain-language summary of a recurrence rule for inline display.
 * "Daily", "Every 2 weeks · Mon, Wed, Fri", "On 5 Jun 2026", etc.
 */
function recurrenceSummary(r: RecurrenceRule): string {
  if (r.type === 'once') {
    if (!r.one_off_date) return 'One-off (no date)';
    const d = new Date(r.one_off_date + 'T00:00:00');
    return `On ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  const every = r.interval > 1 ? `Every ${r.interval} ` : '';
  if (r.type === 'daily')   return r.interval > 1 ? `Every ${r.interval} days` : 'Daily';
  if (r.type === 'weekly') {
    const days = r.weekdays.length === 7 ? 'every day'
      : r.weekdays.map(i => WEEKDAY_SHORT[i]).join(', ') || 'no days';
    return r.interval > 1 ? `Every ${r.interval} weeks · ${days}` : `Weekly · ${days}`;
  }
  if (r.type === 'monthly') return `${every}Monthly`.trim() || 'Monthly';
  if (r.type === 'yearly')  return `${every}Yearly`.trim() || 'Yearly';
  return 'Recurring';
}

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

/**
 * Build a fake TaskList from a template so we can render the same ChecklistCard
 * a real staff user sees, but anchored to today and with no completion state.
 * Used by the manager-side preview toggle — interaction is read-only.
 */
function previewListFromTemplate(tpl: TaskTemplate): TaskList {
  const todayBase = new Date();
  todayBase.setSeconds(0, 0);
  const lines: TaskListLine[] = tpl.lines.map(tl => {
    let deadline_datetime: string | null = null;
    if (tl.deadline_time != null) {
      const h = Math.floor(tl.deadline_time);
      const m = Math.round((tl.deadline_time - h) * 60);
      const d = new Date(todayBase);
      d.setHours(h, m, 0, 0);
      deadline_datetime = d.toISOString();
    }
    return {
      id: -tl.id,                    // negative so it can never collide with a real list line
      name: tl.name,
      sequence: tl.sequence,
      day_part: tl.day_part,
      deadline_datetime,
      photo_required: tl.photo_required,
      photo_uploaded: false,
      photo_instructions: tl.photo_instructions,
      module_link_type: tl.module_link_type,
      state: 'pending',
      completed_at: null,
      completed_by_id: null,
      completed_by_name: null,
      is_ad_hoc: false,
      source_template_line_id: tl.id,
      subtasks: tl.subtasks.map(s => ({
        id: -s.id,
        name: s.name,
        sequence: s.sequence,
        done: false,
        toggled_at: null,
        toggled_by_id: null,
      })),
      attachments: tl.attachments,
      note: null,
      note_at: null,
      note_by_id: null,
      note_by_name: null,
    };
  });
  return {
    id: 0,
    date: todayBase.toISOString().slice(0, 10),
    department_id: tpl.department_id,
    department_name: tpl.department_name,
    company_id: tpl.company_id,
    template_id: tpl.id,
    template_name: tpl.name,
    state: 'draft',
    completion_rate: 0,
    line_count: lines.length,
    completed_count: 0,
    overdue_count: 0,
    photo_pending_count: lines.filter(l => l.photo_required).length,
    lines,
  };
}

export default function TemplateEditPage({ params }: PageProps) {
  const router = useRouter();
  const resolved = (typeof (params as Promise<{ id: string }>).then === 'function')
    ? use(params as Promise<{ id: string }>)
    : (params as { id: string });
  const tplId = parseInt(resolved.id, 10);

  const [tpl, setTpl]         = useState<TaskTemplate | null>(null);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [editingLine, setEditingLine] = useState<TaskTemplateLine | null>(null);
  const [showAddLine, setShowAddLine] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
  const { companyId: activeCompanyId } = useCompany();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tplRes, deptRes] = await Promise.all([
        fetch(`/api/tasks/templates/${tplId}`),
        fetch('/api/tasks/departments'),
      ]);
      const body = await tplRes.json();
      const deptBody = await deptRes.json();
      if (!tplRes.ok) throw new Error(body.error || 'Failed');
      setTpl(body.template);
      if (deptRes.ok) setDepartments(deptBody.departments || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [tplId]);

  useEffect(() => { load(); }, [load, activeCompanyId]);

  async function saveHeader() {
    if (!tpl) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/templates/${tplId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tpl.name, department_id: tpl.department_id }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed');
      showToast('Settings saved');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
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
    if (!body.ok) { showToast(body.error || 'Failed to archive', 'error'); return; }
    window.location.href = '/tasks/manager/templates';
  }

  async function deleteLine(lineId: number) {
    if (!confirm('Delete this task from the template?')) return;
    const res = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}`, { method: 'DELETE' });
    const body = await res.json();
    if (!body.ok) { showToast(body.error || 'Failed to delete', 'error'); return; }
    await load();
    showToast('Task removed');
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
      <AppHeader
        supertitle="TEMPLATE"
        title={tpl.name || 'Template'}
        subtitle={tpl.department_name}
        showBack
        onBack={() => router.push('/tasks/manager/templates')}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreviewMode(v => !v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                previewMode
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white/15 text-white border-white/20 active:bg-white/25'
              }`}
            >
              {previewMode ? '✓ Preview' : '👁 Preview'}
            </button>
            <button
              onClick={archive}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 text-white border border-white/20 active:bg-white/25"
            >
              Archive
            </button>
          </div>
        }
      />

      {previewMode && (
        <div className="max-w-[430px] mx-auto bg-gray-50">
          <div className="bg-amber-100 border-b border-amber-200 px-4 py-2 text-center text-[11px] font-semibold text-amber-800">
            👁 Staff preview · interactions disabled
          </div>
          <div className="bg-orange-500 px-5 pt-5 pb-4">
            <p className="text-orange-100 text-xs font-medium">
              {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <p className="text-white text-lg font-bold mt-0.5">Good day 👋</p>
            <p className="text-orange-100 text-sm mt-0.5">{tpl.department_name}</p>
          </div>
          <div className="px-4 pt-4 pb-8">
            {tpl.lines.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-3xl mb-2">📝</p>
                <p className="font-semibold text-gray-600">Empty list</p>
                <p className="text-sm mt-1">Add tasks in edit mode to see them here.</p>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Today&apos;s tasks</p>
                  <p className="text-xs font-semibold text-gray-500">0 / {tpl.lines.length} done · 0%</p>
                </div>
                <ChecklistCard
                  taskList={previewListFromTemplate(tpl)}
                  onComplete={async () => {}}
                  onSubtaskToggle={async () => {}}
                  onPhotoUpload={async () => {}}
                  readOnly
                />
              </>
            )}
          </div>
        </div>
      )}

      {!previewMode && (
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
              {(() => {
                // Always keep the current department in the option list so the select isn't blank
                // when viewing a template belonging to a company other than the active one.
                const currentInList = departments.some(d => d.id === tpl.department_id);
                const options = currentInList
                  ? departments
                  : [{ id: tpl.department_id, name: tpl.department_name, company_id: tpl.company_id, company_name: '(other company)' } as DepartmentOption, ...departments];
                return (
                  <select
                    value={tpl.department_id}
                    onChange={e => {
                      const newId = parseInt(e.target.value, 10);
                      const match = options.find(d => d.id === newId);
                      setTpl({ ...tpl, department_id: newId, department_name: match?.name ?? tpl.department_name });
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                  >
                    {options.map(d => <option key={d.id} value={d.id}>{d.name} ({d.company_name})</option>)}
                  </select>
                );
              })()}
              <p className="text-[11px] text-gray-400 mt-1">
                Showing departments for the active company. Switch company in the header to pick from a different one.
                Lists already spawned for the old department stay there — only future spawns move.
              </p>
            </div>
            <p className="text-xs text-gray-500 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
              💡 Each task carries its own schedule (daily / weekly / monthly / one-off). Open a task to edit its repeat pattern.
            </p>
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
                          <p className="text-[11px] font-semibold text-orange-600 mt-1">
                            🔁 {recurrenceSummary(l.recurrence)}
                          </p>
                          {l.subtasks.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {l.subtasks.map(s => (
                                <li key={s.id} className="text-xs text-gray-600 flex items-start gap-1.5">
                                  <span className="text-gray-300 mt-0.5">•</span>
                                  <span className="flex-1">{s.name}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {l.photo_instructions && (
                            <p className="text-xs text-blue-700 mt-1.5 italic">📋 {l.photo_instructions}</p>
                          )}
                          {l.attachments.length > 0 && (
                            <div className="mt-1.5">
                              <AttachmentList attachments={l.attachments} compact />
                            </div>
                          )}
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
      )}

      {(showAddLine || editingLine) && (
        <LineModal
          tplId={tplId}
          line={editingLine}
          onClose={() => { setShowAddLine(false); setEditingLine(null); }}
          onSaved={async (msg) => {
            setShowAddLine(false);
            setEditingLine(null);
            await load();
            if (msg) showToast(msg);
          }}
        />
      )}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={dismissToast} />}
    </div>
  );
}

interface LineModalProps {
  tplId: number;
  line: TaskTemplateLine | null;
  onClose: () => void;
  onSaved: (toastMessage?: string) => Promise<void>;
}

interface PendingAttachment {
  /** Local-only id used as React key while the file is queued for upload. */
  tempId: string;
  name: string;
  mimetype: string;
  /** Base64 payload stripped of the data: prefix, ready to POST. */
  base64: string;
  size: number;
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
  const [recurrence, setRecurrence]   = useState<RecurrenceRule>(line?.recurrence ?? defaultRecurrence());
  const [attachments, setAttachments] = useState<TaskAttachment[]>(line?.attachments ?? []);
  const [pendingAtts, setPendingAtts] = useState<PendingAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function uploadAttachment(file: File) {
    setUploadingFile(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error('File read error'));
        r.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1] || '';
      if (line?.id) {
        // Existing line — upload immediately.
        const res = await fetch(`/api/tasks/templates/lines/${line.id}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, mimetype: file.type, data_base64: base64 }),
        });
        const body = await res.json();
        if (!body.ok) throw new Error(body.error || 'Upload failed');
        setAttachments(prev => [...prev, { id: body.id, name: file.name, mimetype: file.type, file_size: file.size }]);
      } else {
        // New line — stash locally; we'll upload after the line is created.
        setPendingAtts(prev => [...prev, {
          tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          mimetype: file.type,
          base64,
          size: file.size,
        }]);
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingFile(false);
    }
  }

  function removePending(tempId: string) {
    setPendingAtts(prev => prev.filter(p => p.tempId !== tempId));
  }

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
          recurrence,
        }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed');

      // Resolve the line id for attachment uploads. PATCH doesn't return the id,
      // but we already have it on `line.id`. POST returns body.line_id for new lines.
      const lineId: number | undefined = line?.id ?? body.line_id;
      let uploadedCount = 0;
      let uploadFailures = 0;
      if (lineId && pendingAtts.length > 0) {
        for (const p of pendingAtts) {
          try {
            const upRes = await fetch(`/api/tasks/templates/lines/${lineId}/attachments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: p.name, mimetype: p.mimetype, data_base64: p.base64 }),
            });
            const upBody = await upRes.json();
            if (upBody.ok) uploadedCount++;
            else uploadFailures++;
          } catch {
            uploadFailures++;
          }
        }
        setPendingAtts([]);
      }

      const baseMsg = line ? 'Task saved' : 'Task added';
      const fileNote = uploadedCount > 0 ? ` · ${uploadedCount} file${uploadedCount === 1 ? '' : 's'} uploaded` : '';
      const failNote = uploadFailures > 0 ? ` · ${uploadFailures} file upload${uploadFailures === 1 ? '' : 's'} failed` : '';
      await onSaved(`${baseMsg}${fileNote}${failNote}`);
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
              <label className="flex items-baseline justify-between text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                <span>Deadline</span>
                <span className="text-[10px] font-medium normal-case tracking-normal text-gray-400">optional</span>
              </label>
              <div className="flex items-center gap-2">
                <input type="time" value={deadline} onChange={e => setDeadline(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                {deadline && (
                  <button type="button" onClick={() => setDeadline('')}
                    className="text-[11px] font-semibold text-gray-500 hover:text-red-600 px-2 py-1 rounded-md hover:bg-gray-100">
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Leave empty if it just needs to be done sometime during the {DAY_PART_OPTIONS.find(o => o.value === dayPart)?.label.toLowerCase()} section.
              </p>
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
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Schedule</label>
            <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Attachments (instructions, references)</label>
            <AttachmentList
              attachments={attachments}
              canDelete
              onDeleted={(id) => setAttachments(prev => prev.filter(a => a.id !== id))}
              compact
            />
            {pendingAtts.length > 0 && (
              <ul className="mt-1 space-y-1">
                {pendingAtts.map(p => (
                  <li key={p.tempId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs">
                    <span>📎</span>
                    <span className="flex-1 min-w-0 truncate text-gray-800">{p.name}</span>
                    <span className="text-[10px] text-amber-700 flex-shrink-0">will upload on save</span>
                    <button onClick={() => removePending(p.tempId)} className="text-[11px] text-red-500 hover:text-red-600 flex-shrink-0">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 bg-orange-50 border-2 border-dashed border-orange-400 rounded-lg text-xs font-semibold text-orange-700 cursor-pointer hover:bg-orange-100">
              {uploadingFile ? '⏳ Reading file…' : '+ Add file (PDF / image)'}
              <input
                type="file"
                className="hidden"
                accept=".pdf,application/pdf,image/*"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadAttachment(f);
                  e.target.value = '';
                }}
              />
            </label>
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

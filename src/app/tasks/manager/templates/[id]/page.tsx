'use client';

import { useEffect, useRef, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TaskTemplate, TaskTemplateLine, TaskAttachment, TaskList, TaskListLine, DayPart, ModuleLink, RecurrenceRule, DepartmentOption } from '@/lib/odoo-tasks';
import AppHeader from '@/components/ui/AppHeader';
import { useCompany } from '@/lib/company-context';
import AttachmentList from '../../../_components/AttachmentList';
import ChecklistCard from '../../../_components/ChecklistCard';
import RecurrenceEditor from '../../../_components/RecurrenceEditor';
import SetupGuideEditor, { type GuidePin, type EditorPhoto } from '../../../_components/SetupGuideEditor';
import { compressImage } from '../../../_components/photoUpload';
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
      is_setup_guide: tl.is_setup_guide,
      has_setup_photo: tl.has_setup_photo,
      setup_photo_seqs: tl.setup_photo_seqs,
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
        pin_x: s.pin_x,
        pin_y: s.pin_y,
        pin_photo_seq: s.pin_photo_seq,
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

  // Two ordering tokens keep overlapping loads correct for the common case:
  //  - dataGen orders ANY write to tpl (a foreground reload OR a background
  //    lines-only refresh), so a slow/stale response can never overwrite a
  //    fresher one — only the latest-STARTED writer applies its tpl.
  //  - fgGen orders FOREGROUND-only state (departments, error). A background
  //    lines refresh has no departments/error to contribute, so it must NOT
  //    invalidate a foreground load's authority over them.
  // KNOWN RESIDUAL (generic, out of scope): dataGen is a single per-tpl token, so
  // a background lines-refresh that STARTS after a foreground reload can suppress
  // that reload's full write and leave header fields (name/department/line_count)
  // briefly stale — those rarely change server-side and line_count isn't rendered
  // here; the next foreground load reconciles. A fully race-free version would
  // need per-FIELD version tracking, which isn't warranted for this page.
  const dataGen = useRef(0);
  const fgGen = useRef(0);
  // silent: a BACKGROUND refresh that never shows the loading skeleton (so it
  // can't unmount an open modal) and merges ONLY tpl.lines (so it can't clobber
  // the manager's unsaved header edits or change an open modal's departmentId).
  // Used after a save whose own modal was dismissed mid-flight: the write
  // committed, so the list must reflect it — safe to run even with a modal open.
  const load = useCallback(async (silent = false) => {
    const myData = ++dataGen.current;
    const myFg = silent ? fgGen.current : ++fgGen.current;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const [tplRes, deptRes] = await Promise.all([
        fetch(`/api/tasks/templates/${tplId}`),
        fetch('/api/tasks/departments'),
      ]);
      const body = await tplRes.json();
      const deptBody = await deptRes.json();
      if (!tplRes.ok) throw new Error(body.error || 'Failed');
      if (!silent && myFg === fgGen.current && deptRes.ok) setDepartments(deptBody.departments || []);
      if (myData === dataGen.current) {
        // Foreground replaces the whole template; a silent refresh merges only
        // lines onto the current header (never touches name/department).
        setTpl(prev => (silent && prev) ? { ...prev, lines: body.template.lines } : body.template);
      }
    } catch (e: unknown) {
      if (!silent && myFg === fgGen.current) setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      if (!silent) setLoading(false);
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
          departmentId={tpl.department_id}
          line={editingLine}
          onClose={() => { setShowAddLine(false); setEditingLine(null); }}
          onSaved={async (msg) => {
            setShowAddLine(false);
            setEditingLine(null);
            await load();
            if (msg) showToast(msg);
          }}
          onBackgroundRefresh={() => { void load(true); }}
        />
      )}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={dismissToast} />}
    </div>
  );
}

interface LineModalProps {
  tplId: number;
  departmentId: number;
  line: TaskTemplateLine | null;
  onClose: () => void;
  onSaved: (toastMessage?: string) => Promise<void>;
  /** Refresh the parent list after a save whose own modal was dismissed
   * mid-flight. A background (non-blanking, lines-only) refresh — safe to run
   * even with another modal open. */
  onBackgroundRefresh: () => void;
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

function LineModal({ tplId, departmentId, line, onClose, onSaved, onBackgroundRefresh }: LineModalProps) {
  const [name, setName]               = useState(line?.name ?? '');
  const [dayPart, setDayPart]         = useState<DayPart>(line?.day_part ?? 'opening');
  const [deadline, setDeadline]       = useState(floatToHHMM(line?.deadline_time));
  const [photoRequired, setPhotoReq]  = useState(line?.photo_required ?? false);
  const [photoInstructions, setPhotoInstr] = useState(line?.photo_instructions ?? '');
  const [moduleLink, setModuleLink]   = useState<ModuleLink>(line?.module_link_type ?? 'none');
  // One subtask array carries both plain subtasks and setup-guide pins (pin_x/pin_y/photo/item).
  const [subtasks, setSubtasks]       = useState<GuidePin[]>(
    line?.subtasks.map(s => ({ id: s.id, name: s.name, pin_x: s.pin_x, pin_y: s.pin_y, pin_photo_seq: s.pin_photo_seq, item_id: s.item_id })) ?? [],
  );
  const [recurrence, setRecurrence]   = useState<RecurrenceRule>(line?.recurrence ?? defaultRecurrence());
  const [attachments, setAttachments] = useState<TaskAttachment[]>(line?.attachments ?? []);
  const [pendingAtts, setPendingAtts] = useState<PendingAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // ── Setup guide (multi-photo) ───────────────────────────────
  // `photos` mixes server photos (URL route) and pending uploads (data URL,
  // uploaded on save with their client-assigned seq). Removed server photos are
  // collected and DELETEd on save.
  const [isSetupGuide, setIsSetupGuide] = useState(line?.is_setup_guide ?? false);
  const [photos, setPhotos] = useState<EditorPhoto[]>(
    (line?.setup_photo_seqs ?? []).map(seq => ({
      seq,
      url: `/api/tasks/templates/${tplId}/lines/${line!.id}/setup-photo?seq=${seq}`,
    })),
  );
  const [removedSeqs, setRemovedSeqs] = useState<number[]>([]);
  // Count of photos still compressing — Save is blocked until they land, so a
  // pick started before Save can't finish after submit() snapshots `photos`.
  const [photoBusy, setPhotoBusy] = useState(0);
  // New lines: remember the id created by the first successful save, so a retry
  // after a failed photo upload PATCHes instead of POSTing a duplicate task.
  const [createdLineId, setCreatedLineId] = useState<number | null>(null);
  // Provisional seqs for not-yet-uploaded photos live at 1,000,000+ so they (a)
  // sort AFTER every real photo — keeping add-order on screen — and (b) sit far
  // above any real seq that can exist: the server allocates seqs from 0 (MAX+1)
  // and a line holds at most a handful of reference photos, so real seqs stay in
  // the low tens and can never reach the provisional band. 1,000,000 + a small
  // per-editor counter also can't overflow Odoo's int4 (max ~2.1e9). So against
  // our own client — which only APPENDS new photos (server picks the real seq)
  // or REPLACES an existing small seq, and never posts a photo in the 1M band —
  // a provisional-vs-real collision cannot occur, and pins are remapped to real
  // seqs on save. RESIDUAL (documented-deferred): a *different* authorized client
  // deliberately creating a photo at a >=1,000,000 seq could still collide. Fully
  // closing that adversarial case means taking the pin<->photo link off the
  // shared integer namespace (opaque photo keys) or a server-side transactional
  // save-guide aggregate — out of scope for this client fast-follow.
  const seqRef = useRef<number>(1_000_000);

  // Set when the manager dismisses the modal. A save already in flight then skips
  // its onSaved (which refreshes the list and closes the CURRENTLY open modal), so
  // a dismissed task's late-completing save can't close a DIFFERENT task the
  // manager has since opened. Dismissal stays available during a save (no lockout
  // if a request hangs); the write still commits server-side, we just don't
  // reach across to a modal that has moved on.
  const closedRef = useRef(false);
  const handleClose = () => { closedRef.current = true; onClose(); };

  async function addSetupPhoto(file: File) {
    // Provisional local seq only — the SERVER assigns the real one on append
    // (append-without-seq), and submit() remaps pins if it differs.
    const seq = seqRef.current++;
    setPhotoBusy(n => n + 1);
    try {
      const { base64 } = await compressImage(file, 1280, 0.85);
      // Insert in seq order: overlapping compressions finish out of order, and
      // the server sorts by seq — keep the on-screen order identical.
      setPhotos(prev => [...prev, { seq, url: `data:image/jpeg;base64,${base64}`, pendingBase64: base64, isNew: true }]
        .sort((a, b) => a.seq - b.seq));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not read image');
    } finally {
      setPhotoBusy(n => n - 1);
    }
  }

  async function replaceSetupPhoto(seq: number, file: File) {
    const hasPins = subtasks.some(s => s.pin_photo_seq === seq);
    if (hasPins && !confirm('Replacing this photo clears the pins placed on it. Continue?')) return;
    setPhotoBusy(n => n + 1);
    try {
      const { base64 } = await compressImage(file, 1280, 0.85);
      if (hasPins) setSubtasks(prev => prev.filter(s => s.pin_photo_seq !== seq));
      setPhotos(prev => prev.map(p => p.seq === seq
        // Preserve isNew: replacing a not-yet-uploaded photo must still APPEND
        // (no seq) on save, or it could overwrite another editor's slot.
        ? { ...p, url: `data:image/jpeg;base64,${base64}`, pendingBase64: base64 }
        : p));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not read image');
    } finally {
      setPhotoBusy(n => n - 1);
    }
  }

  function removeSetupPhoto(seq: number) {
    const target = photos.find(p => p.seq === seq);
    if (!target) return;
    setPhotos(prev => prev.filter(p => p.seq !== seq));
    setSubtasks(prev => prev.filter(s => s.pin_photo_seq !== seq));
    if (!target.pendingBase64) setRemovedSeqs(prev => [...prev, seq]);
  }

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
    if (photoBusy > 0) { setError('A photo is still processing — try again in a moment'); return; }
    // An attachment FileReader still running would land in pendingAtts AFTER this
    // closure snapshotted it — the file would be silently dropped on save.
    if (uploadingFile) { setError('A file is still being read — try again in a moment'); return; }
    const cleanSubtasks = subtasks.filter(s => s.name.trim());
    // A setup guide needs at least one photo and at least one pin.
    if (isSetupGuide) {
      if (photos.length === 0) { setError('Add at least one reference photo for the setup guide'); return; }
      if (cleanSubtasks.length === 0) { setError('Add at least one pin to the setup guide'); return; }
    }
    setSubmitting(true); setError(null);
    try {
      // Reusable builders so the initial save and a post-upload pin-remap re-save
      // send the FULL line body (a subtasks-only PATCH would coerce omitted
      // fields like deadline_time/photo_required to defaults and corrupt the line).
      const subtasksPayload = (seqMap?: Map<number, number>) => cleanSubtasks.map((s, i) => ({
        id: s.id,
        name: s.name.trim(),
        sequence: (i + 1) * 10,
        ...(isSetupGuide ? {
          pin_x: s.pin_x, pin_y: s.pin_y,
          pin_photo_seq: seqMap ? (seqMap.get(s.pin_photo_seq) ?? s.pin_photo_seq) : s.pin_photo_seq,
          item_id: s.item_id ?? null,
        } : {}),
      }));
      const lineBody = (seqMap?: Map<number, number>) => ({
        name: name.trim(),
        day_part: dayPart,
        deadline_time: hhmmToFloat(deadline),
        photo_required: photoRequired,
        photo_instructions: photoRequired && photoInstructions.trim() ? photoInstructions.trim() : null,
        module_link_type: moduleLink,
        is_setup_guide: isSetupGuide,
        subtasks: subtasksPayload(seqMap),
        recurrence,
      });

      // A retry after a failed photo upload must PATCH the already-created line.
      const existingId = line?.id ?? createdLineId;
      const url = existingId
        ? `/api/tasks/templates/${tplId}/lines/${existingId}`
        : `/api/tasks/templates/${tplId}/lines`;
      const method = existingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lineBody()),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed');

      // Resolve the line id for photo/attachment uploads. PATCH doesn't return the
      // id, but we already have it. POST returns body.line_id — remember it so a
      // retry can't create a duplicate task.
      const lineId: number | undefined = existingId ?? body.line_id;
      if (!existingId && body.line_id) setCreatedLineId(body.line_id);

      // Upload pending photos. NEW photos APPEND (no seq → the server allocates
      // the sequence atomically, so two managers editing the same guide can't
      // overwrite each other); EXISTING photos REPLACE their seq. If the server
      // hands back a different seq than the provisional one (concurrent edit),
      // remap the pins and re-save the line. Failures keep the modal open for retry.
      if (isSetupGuide && lineId) {
        const uploaded: { seq: number; base64: string; realSeq: number }[] = [];
        const seqRemap = new Map<number, number>();
        let uploadError: string | null = null;
        for (const p of photos) {
          if (!p.pendingBase64) continue;
          try {
            const upRes = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}/setup-photo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data_base64: p.pendingBase64, ...(p.isNew ? {} : { seq: p.seq }) }),
            });
            const upBody = await upRes.json().catch(() => ({}));
            if (!upRes.ok || !upBody.ok) { uploadError = upBody.error || 'A photo upload failed'; }
            else {
              const realSeq = typeof upBody.seq === 'number' ? upBody.seq : p.seq;
              if (p.isNew && realSeq !== p.seq) seqRemap.set(p.seq, realSeq);
              uploaded.push({ seq: p.seq, base64: p.pendingBase64, realSeq });
            }
          } catch {
            uploadError = 'A photo upload failed';
          }
        }
        // Persist pins for the SUCCEEDED photos even on a partial batch failure,
        // and mirror the server seqs into client state, so a retry carries the
        // correct pin seqs and its line save re-persists them if this PATCH fails.
        if (seqRemap.size) {
          try {
            const rmRes = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(lineBody(seqRemap)),
            });
            const rmBody = await rmRes.json().catch(() => ({}));
            if (!rmRes.ok || !rmBody.ok) uploadError = uploadError || (rmBody.error || 'Failed to link pins to photos');
          } catch {
            // A thrown PATCH must NOT skip finalization below — else succeeded
            // appends stay pending and re-append on retry.
            uploadError = uploadError || 'Failed to link pins to photos';
          }
          setSubtasks(prev => prev.map(s => seqRemap.has(s.pin_photo_seq)
            ? { ...s, pin_photo_seq: seqRemap.get(s.pin_photo_seq)! } : s));
        }
        // Finalize EVERY succeeded upload — adopt its server seq and drop
        // pending + isNew — so a retry REPLACES (not re-appends) it and its first
        // server copy can't be orphaned.
        if (uploaded.length) {
          setPhotos(prev => prev.map(p => {
            const u = uploaded.find(x => x.seq === p.seq && x.base64 === p.pendingBase64);
            return u ? { seq: u.realSeq, url: p.url, isNew: false } : p;
          }));
        }
        if (uploadError) {
          // Modal dismissed mid-save: the LINE already committed, so refresh the
          // list in the background rather than writing a retry error into an
          // unmounted modal (the manager can't retry a dismissed modal anyway).
          if (closedRef.current) { onBackgroundRefresh(); return; }
          setError(`${uploadError} — press Save to retry.`);
          setSubmitting(false);
          return;
        }
      }

      let photoCleanupFailed = false;
      if (lineId) {
        // Individual photos the manager removed (server photos only).
        for (const seq of removedSeqs) {
          try {
            const delRes = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}/setup-photo?seq=${seq}`, { method: 'DELETE' });
            const delBody = await delRes.json().catch(() => ({}));
            if (!delRes.ok || !delBody.ok) photoCleanupFailed = true;
          } catch { photoCleanupFailed = true; }
        }
        // Guide turned off entirely — clear all photos. Do NOT clear pins: the
        // upsert above already saved the subtasks the manager kept (now plain
        // subtasks); their stale pin coords are ignored while the flag is off.
        if (!isSetupGuide && line?.has_setup_photo) {
          try {
            const delRes = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}/setup-photo`, { method: 'DELETE' });
            const delBody = await delRes.json().catch(() => ({}));
            if (!delRes.ok || !delBody.ok) photoCleanupFailed = true;
          } catch { photoCleanupFailed = true; }
        }
      }

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

      // The manager dismissed this modal mid-save: the write has committed, so
      // refresh the list in the BACKGROUND (keep it current, avoid a duplicate
      // add or a stale-reopen overwrite), but do NOT call onSaved — that would
      // close whatever modal is open now (possibly a different task).
      if (closedRef.current) { onBackgroundRefresh(); return; }
      const baseMsg = line ? 'Task saved' : 'Task added';
      const fileNote = uploadedCount > 0 ? ` · ${uploadedCount} file${uploadedCount === 1 ? '' : 's'} uploaded` : '';
      const failNote = uploadFailures > 0 ? ` · ${uploadFailures} file upload${uploadFailures === 1 ? '' : 's'} failed` : '';
      const photoNote = photoCleanupFailed ? ' · old photo not removed — reopen to retry' : '';
      await onSaved(`${baseMsg}${fileNote}${failNote}${photoNote}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={handleClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800 text-lg px-5 pt-5 pb-3 flex-shrink-0">{line ? 'Edit task' : 'Add task'}</h2>
        <div className="flex-1 overflow-y-auto px-5 space-y-3 min-h-0">
          {/* Freeze EVERY control while a save is in flight: fieldset[disabled]
              natively disables all descendant inputs/selects/buttons, so no
              mid-save edit — e.g. unchecking Setup guide to reach the plain
              subtask list — can mutate state the submit already snapshotted. */}
          <fieldset disabled={submitting} className="space-y-3 min-w-0 border-0 p-0 m-0">
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isSetupGuide}
              onChange={e => setIsSetupGuide(e.target.checked)}
            />
            <span>📍 Setup guide <span className="text-gray-400 font-normal">(photo with numbered pins)</span></span>
          </label>

          {isSetupGuide ? (
            <SetupGuideEditor
              departmentId={departmentId}
              pins={subtasks}
              onPinsChange={setSubtasks}
              photos={photos}
              onAddPhoto={addSetupPhoto}
              onReplacePhoto={replaceSetupPhoto}
              onRemovePhoto={removeSetupPhoto}
              disabled={submitting}
            />
          ) : (
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
                <button onClick={() => setSubtasks(prev => [...prev, { name: '', pin_x: 0, pin_y: 0, pin_photo_seq: 0 }])}
                  className="text-xs font-semibold text-orange-600 hover:text-orange-700">
                  + Add subtask
                </button>
              </div>
            </div>
          )}
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
                // Block a second pick while a read is running: uploadingFile is a
                // boolean, so overlapping reads would let the first finish, enable
                // Save, and drop the still-reading second file on submit.
                disabled={uploadingFile}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadAttachment(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          </fieldset>
          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
          <div className="h-2" />
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-white">
          <button onClick={handleClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={submitting || photoBusy > 0 || uploadingFile} className="flex-1 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
            {submitting ? 'Saving…' : photoBusy > 0 ? 'Processing photo…' : uploadingFile ? 'Reading file…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

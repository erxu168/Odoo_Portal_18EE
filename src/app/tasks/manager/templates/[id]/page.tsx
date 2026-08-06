'use client';

import { useEffect, useRef, useState, useCallback, use } from 'react';
import DropZone from '@/components/ui/DropZone';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TaskTemplate, TaskTemplateLine, TaskAttachment, TaskList, TaskListLine, DayPart, ModuleLink, RecurrenceRule, DepartmentOption } from '@/lib/odoo-tasks';
import { MAX_MANAGER_NOTE } from '@/lib/task-limits';
import RichTextEditor from '@/components/ui/RichTextEditor';
import RichText from '@/components/ui/RichText';
import { toEditorHtml, richTextToPlain } from '@/lib/rich-text';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import DragRow from '@/components/ui/DragRow';
import AppHeader from '@/components/ui/AppHeader';
import { useCompany } from '@/lib/company-context';
import AttachmentList from '../../../_components/AttachmentList';
import ChecklistCard from '../../../_components/ChecklistCard';
import RecurrenceEditor from '../../../_components/RecurrenceEditor';
import GuidePicker, { GuideAttachModal } from '../../../_components/GuidePicker';
import Toast from '@/components/ui/Toast';
import { useToast } from '../../../_components/useToast';

/**
 * The two editor-local shapes that used to live in SetupGuideEditor.tsx — that
 * component was dead (imported for these types only) and has been deleted,
 * along with the equally unreferenced SetupGuideView.tsx.
 *
 * The pin type was renamed on the way across: it is a SUBTASK that may carry
 * pin coordinates, while lib/task-guide already exports a DIFFERENT shape under
 * the old name (a note-pin on a guide step: {pin_x, pin_y, note}). Two unrelated
 * shapes sharing one name is a trap worth not leaving behind.
 */
interface EditorSubtask {
  id?: number;
  name: string;
  pin_x: number;
  pin_y: number;
  /** Sequence of the setup-guide photo this pin sits on. */
  pin_photo_seq: number;
  item_id?: number | null;
}

/** One reference photo as the editor sees it — a server photo or a pending upload. */
interface EditorPhoto {
  /** Local seq: for existing photos this is the server sequence; for a NEW photo
   * it is a provisional value the server may reassign on append (then remapped). */
  seq: number;
  /** Display source: server route URL, or a local data URL while pending. */
  url: string;
  /** Set while the photo hasn't been uploaded yet (uploaded on save). */
  pendingBase64?: string;
  /** True for a photo added this session (server allocates its real seq on append). */
  isNew?: boolean;
}

const DAY_PART_OPTIONS: { value: DayPart; label: string }[] = [
  { value: 'opening', label: 'Opening' },
  { value: 'mid_day', label: 'Service' },
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
      manager_note: tl.manager_note,
      deadline_is_implicit: false,
      module_link_type: tl.module_link_type,
      is_setup_guide: tl.is_setup_guide,
      has_setup_photo: tl.has_setup_photo,
      setup_photo_seqs: tl.setup_photo_seqs,
      // Staff only ever see a PUBLISHED guide, so the preview mirrors that:
      // show the "Show me how" button only when the guide is live with steps.
      has_guide: tl.guide_published && tl.guide_step_count > 0,
      guide_step_count: tl.guide_step_count,
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
  const { confirm, confirmElement } = useConfirm();
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
        // Re-read today's guide state with it. Fetching this only on mount meant
        // the refresh badge never appeared in the very session that created the
        // need for it — publish a guide, come back, and the button was missing.
        void loadTodayGuidesRef.current?.();
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
    if (!await confirm({
      title: 'Archive this template?',
      message: 'Daily spawning will stop. You can unarchive it later.',
      confirmLabel: 'Archive',
      variant: 'danger',
    })) return;
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
    if (!await confirm({
      title: 'Delete this task?',
      message: 'It is removed from the template, so it stops appearing on future days. Days that already ran keep their copy.',
      confirmLabel: 'Delete task',
      variant: 'danger',
    })) return;
    const res = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}`, { method: 'DELETE' });
    const body = await res.json();
    if (!body.ok) { showToast(body.error || 'Failed to delete', 'error'); return; }
    await load();
    showToast('Task removed');
  }

  // ── Reorder tasks within a day-part section (drag and drop) ────────────────
  const [reordering, setReordering] = useState(false);
  const sensors = useSensors(
    // 8px before a mouse drag starts, and a 200ms hold on touch — otherwise
    // every attempt to SCROLL the task list would pick a task up instead.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onSectionDragEnd(part: DayPart, e: DragEndEvent) {
    const { active, over } = e;
    if (reordering) return;   // a drop delivered mid-save must not race it
    if (!over || active.id === over.id || !tpl) return;
    const section = tpl.lines
      .filter(l => l.day_part === part)
      .sort((a, b) => a.sequence - b.sequence || a.id - b.id);
    const oldIndex = section.findIndex(l => l.id === active.id);
    const newIndex = section.findIndex(l => l.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const orderedIds = arrayMove(section, oldIndex, newIndex).map(l => l.id);
    // Optimistic: renumber locally with exactly the sequences the server will
    // write (10, 20, 30 …), so the row settles where it was dropped instead of
    // snapping back for a round trip.
    const seqById = new Map(orderedIds.map((id, i) => [id, (i + 1) * 10]));
    setTpl(prev => prev ? {
      ...prev,
      lines: prev.lines.map(l => (seqById.has(l.id) ? { ...l, sequence: seqById.get(l.id)! } : l)),
    } : prev);

    setReordering(true);
    try {
      const res = await fetch(`/api/tasks/templates/${tplId}/lines/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered_ids: orderedIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || 'Could not save the new order');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not save the new order', 'error');
      // Put it back the way the server actually has it — never leave the screen
      // showing an order that was not persisted.
      await load();
    } finally {
      setReordering(false);
    }
  }

  /**
   * Which tasks have a guide copy on TODAY's list that is out of date.
   *
   * A daily task carries a FROZEN copy of the guide taken when the list was
   * built, so a guide published (or edited) later never reaches a list that
   * already exists — the "I published it, why doesn't the task show it?"
   * surprise. One call badges every row.
   */
  const [todayGuides, setTodayGuides] = useState<Record<string, { stale: boolean; guide_published: boolean }>>({});
  const [refreshingLine, setRefreshingLine] = useState<number | null>(null);
  /** Ref, not a dep: load() is declared above loadTodayGuides, and adding it as
   *  a dependency would rebuild load() on every change and restart its fetch. */
  const loadTodayGuidesRef = useRef<(() => Promise<void>) | null>(null);

  const loadTodayGuides = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/templates/${tplId}/today-guides`);
      const body = await res.json().catch(() => ({}));
      setTodayGuides(res.ok && body.ok ? (body.status || {}) : {});
    } catch {
      setTodayGuides({});   // a badge is never worth breaking the page for
    }
  }, [tplId]);

  useEffect(() => {
    loadTodayGuidesRef.current = loadTodayGuides;
    void loadTodayGuides();
  }, [loadTodayGuides]);

  async function refreshTodayGuide(lineId: number, taskName: string) {
    if (refreshingLine) return;
    if (!await confirm({
      title: 'Update today\u2019s copy?',
      // Honest about the one real side effect: replacing the copy invalidates the
      // step ids the player is holding, so anyone reading it AT THAT MOMENT has
      // to reopen it. Claiming "nothing is affected" would have been a lie.
      message: `Staff doing “${taskName}” today will get the current version of the guide. Earlier days keep the version they were shown, and finished tasks are left alone. Anyone with the guide open right now will need to close and reopen it.`,
      confirmLabel: 'Update today\u2019s copy',
    })) return;

    setRefreshingLine(lineId);
    try {
      const res = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}/guide-refresh`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || 'Could not update today\u2019s copy');
      if (body.refreshed) showToast('Today\u2019s copy updated');
      else if (body.reason === 'guide_not_published') showToast('Publish the guide first — staff never receive a draft', 'error');
      else if (body.reason === 'not_on_today') showToast('That task isn\u2019t on today\u2019s list', 'error');
      else if (body.reason === 'already_done') showToast('Someone already finished that task today — its copy is left as they saw it', 'info');
      else if (body.reason === 'busy') showToast('Someone else just updated it — refreshed', 'info');
      else showToast('Nothing to update', 'info');
      await loadTodayGuides();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not update today\u2019s copy', 'error');
    } finally {
      setRefreshingLine(null);
    }
  }

  /**
   * A day's list is a SNAPSHOT taken once at spawn, so a task added to the
   * template today would otherwise only appear tomorrow — which is exactly the
   * surprise this offer removes.
   *
   * The server decides whether it CAN be added (list exists, the task's own
   * schedule fires today, not already on it), so the prompt never offers
   * something the write would refuse. Declining is a normal outcome, not an
   * error: the task still starts tomorrow either way.
   */
  async function offerAddToToday(lineId: number) {
    let status: { can_add?: boolean; date?: string; department_name?: string };
    try {
      const res = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}/today`);
      status = await res.json().catch(() => ({}));
      if (!res.ok || !status?.can_add) return;   // nothing to offer — stay quiet
    } catch {
      return;                                     // never block the save on this
    }

    const when = status.date
      ? new Date(`${status.date}T00:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
      : 'today';
    const ok = await confirm({
      title: 'Add it to today\u2019s list too?',
      message: `${status.department_name || 'This department'} is already working from the list for ${when}. A new task normally starts tomorrow — put it on today\u2019s list as well?`,
      confirmLabel: 'Add to today\u2019s list',
      cancelLabel: 'Just from tomorrow',
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}/today`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || 'Could not add it to today\u2019s list');
      showToast(body.added ? 'Added to today\u2019s list' : 'It was already on today\u2019s list');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not add it to today\u2019s list', 'error');
    }
  }

  /** Tasks whose linked guide is still a draft — staff receive no guide at all
   *  for these, and the preview cannot show one either. */
  // Same gate the row badge uses (guide_step_count > 0), because TaskTemplateLine
  // carries no guide_id — an unlinked task reads as 0 steps either way.
  const draftGuideCount = tpl?.lines.filter(l => l.guide_step_count > 0 && !l.guide_published).length ?? 0;

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
        <Link href="/tasks/manager/templates" className="text-[var(--fs-sm)] text-gray-400">← Templates</Link>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-[var(--fs-sm)] mt-4">{error || 'Not found'}</div>
      </div>
    );
  }

  const grouped: Record<DayPart, TaskTemplateLine[]> = { opening: [], mid_day: [], closing: [] };
  for (const l of tpl.lines) grouped[l.day_part].push(l);
  // Sort by sequence here, not just by arrival order: a drag renumbers lines
  // optimistically in state, and this is what turns that into a re-render.
  // `id` breaks ties so equal sequences (older rows) stay stable.
  for (const part of Object.keys(grouped) as DayPart[]) {
    grouped[part].sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  }

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
              className={`text-[var(--fs-xs)] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                previewMode
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white/15 text-white border-white/20 active:bg-white/25'
              }`}
            >
              {previewMode ? '✓ Preview' : '👁 Preview'}
            </button>
            <button
              onClick={archive}
              className="text-[var(--fs-xs)] font-semibold px-3 py-1.5 rounded-full bg-white/15 text-white border border-white/20 active:bg-white/25"
            >
              Archive
            </button>
          </div>
        }
      />

      {previewMode && (
        <div className="max-w-[430px] mx-auto bg-gray-50">
          <div className="bg-gray-100 border-b border-gray-200 px-4 py-2 text-center text-[var(--fs-xs)] font-semibold text-gray-600">
            👁 Staff preview · interactions disabled
          </div>
          {/* The preview hides a draft guide because STAFF never receive one —
              the daily spawn only snapshots a published guide with steps. Without
              this note the preview looks simply broken ("I linked it, where is
              it?"), which is exactly how it was first reported. */}
          {draftGuideCount > 0 && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-[var(--fs-xs)] text-amber-800">
              <b>
                {draftGuideCount === 1
                  ? '1 task links a guide that is still a draft.'
                  : `${draftGuideCount} tasks link a guide that is still a draft.`}
              </b>{' '}
              Staff never get a draft, so it is hidden here too. Open the task, tap
              <b> Edit guide</b>, turn on <b>Publish</b> and save.
            </div>
          )}
          <div className="bg-[#2563EB] px-5 pt-5 pb-4">
            <p className="text-white/70 text-[var(--fs-xs)] font-medium">
              {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <p className="text-white text-[var(--fs-lg)] font-bold mt-0.5">Good day 👋</p>
            <p className="text-white/70 text-[var(--fs-sm)] mt-0.5">{tpl.department_name}</p>
          </div>
          <div className="px-4 pt-4 pb-8">
            {tpl.lines.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-3xl mb-2">📝</p>
                <p className="font-semibold text-gray-600">Empty list</p>
                <p className="text-[var(--fs-sm)] mt-1">Add tasks in edit mode to see them here.</p>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-400">Today&apos;s tasks</p>
                  <p className="text-[var(--fs-xs)] font-semibold text-gray-500">0 / {tpl.lines.length} done · 0%</p>
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
          <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-400 mb-3">Settings</p>
          <div className="space-y-3">
            <div>
              <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Name</label>
              <input value={tpl.name} onChange={e => setTpl({ ...tpl, name: e.target.value })}
                className="w-full px-3 py-2 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Department</label>
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
                    className="w-full px-3 py-2 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  >
                    {options.map(d => <option key={d.id} value={d.id}>{d.name} ({d.company_name})</option>)}
                  </select>
                );
              })()}
              <p className="text-[var(--fs-xs)] text-gray-400 mt-1">
                Showing departments for the active company. Switch company in the header to pick from a different one.
                Lists already spawned for the old department stay there — only future spawns move.
              </p>
            </div>
            <p className="text-[var(--fs-xs)] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              💡 Each task carries its own schedule (daily / weekly / monthly / one-off). Open a task to edit its repeat pattern.
            </p>
            <button onClick={saveHeader} disabled={saving}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg text-[var(--fs-sm)] font-semibold hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-400">Tasks</p>
            <button onClick={() => setShowAddLine(true)} className="text-[var(--fs-sm)] font-semibold text-green-700 hover:text-green-800">
              + Add task
            </button>
          </div>
          <div className="space-y-3">
            {(['opening', 'mid_day', 'closing'] as DayPart[]).map(part => {
              const lines = grouped[part];
              if (lines.length === 0) return null;
              return (
                <div key={part} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  <p className="px-4 py-2 text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-200">
                    {DAY_PART_OPTIONS.find(o => o.value === part)?.label}
                  </p>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={e => onSectionDragEnd(part, e)}
                  >
                  <SortableContext items={lines.map(l => l.id)} strategy={verticalListSortingStrategy}>
                  {lines.map((l, i) => (
                    <DragRow
                      key={l.id}
                      id={l.id}
                      className={`bg-white px-4 py-3 ${i < lines.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      {handle => (
                      <div className="flex items-start justify-between gap-3">
                        <div className="pt-0.5">{handle}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[var(--fs-sm)] text-gray-800">{l.name}</p>
                          <p className="text-[var(--fs-xs)] text-gray-400 mt-0.5">
                            {l.deadline_time != null ? `By ${floatToHHMM(l.deadline_time)} · ` : ''}
                            {l.photo_required ? '\u{1F4F8} required · ' : ''}
                            {l.module_link_type !== 'none' ? `${l.module_link_type} · ` : ''}
                            {l.subtasks.length > 0 ? `${l.subtasks.length} subtask${l.subtasks.length === 1 ? '' : 's'}` : 'no subtasks'}
                          </p>
                          <p className="text-[var(--fs-xs)] font-semibold text-green-700 mt-1">
                            🔁 {recurrenceSummary(l.recurrence)}
                          </p>
                          {l.guide_step_count > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                                📖 Guide · {l.guide_step_count} step{l.guide_step_count === 1 ? '' : 's'}
                              </span>
                              {l.guide_published ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold bg-green-50 text-green-700 border border-green-200">
                                  ● Live
                                </span>
                              ) : (
                                // Amber, and it says what it MEANS. A draft guide is
                                // not a neutral state: the spawn skips it and the
                                // staff player never receives it, so the task ships
                                // with no how-to at all. "Draft" alone read as
                                // harmless and cost a manager a confused bug report.
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                                  ● Draft — staff can&apos;t see it yet
                                </span>
                              )}
                            </div>
                          )}
                          {todayGuides[String(l.id)]?.stale && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {/* Only offer the refresh when it would actually work.
                                  With the guide unpublished the server refuses (it
                                  will not strip a guide staff may be mid-way
                                  through), so offering a button there would be a
                                  dead end — say what is happening instead. */}
                              {(
                                todayGuides[String(l.id)]?.guide_published ? (
                                  <button
                                    type="button"
                                    onClick={() => refreshTodayGuide(l.id, l.name)}
                                    disabled={refreshingLine === l.id}
                                    className="inline-flex items-center gap-1 px-2 min-h-[32px] rounded-full text-[var(--fs-xs)] font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 disabled:opacity-50"
                                  >
                                    {refreshingLine === l.id ? 'Updating…' : '↻ Today’s copy is older — update it'}
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                                    Today’s list still shows the old guide · stops tomorrow
                                  </span>
                                )
                              )}
                            </div>
                          )}
                          {l.manager_note && (
                            <div className="text-[var(--fs-xs)] text-gray-500 mt-1.5 flex items-start gap-1">
                              <span aria-hidden="true">📌</span>
                              <RichText value={l.manager_note} className="min-w-0 flex-1" />
                            </div>
                          )}
                          {l.subtasks.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {l.subtasks.map(s => (
                                <li key={s.id} className="text-[var(--fs-xs)] text-gray-600 flex items-start gap-1.5">
                                  <span className="text-gray-300 mt-0.5">•</span>
                                  <span className="flex-1">{s.name}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {l.photo_instructions && (
                            <p className="text-[var(--fs-xs)] text-blue-700 mt-1.5 italic">📋 {l.photo_instructions}</p>
                          )}
                          {l.attachments.length > 0 && (
                            <div className="mt-1.5">
                              <AttachmentList attachments={l.attachments} compact />
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => setEditingLine(l)} className="min-h-[44px] px-3 inline-flex items-center text-[var(--fs-xs)] font-semibold text-gray-500 hover:text-green-700">Edit</button>
                          <button onClick={() => deleteLine(l.id)} className="min-h-[44px] px-3 inline-flex items-center text-[var(--fs-xs)] font-semibold text-red-500 hover:text-red-700">Delete</button>
                        </div>
                      </div>
                      )}
                    </DragRow>
                  ))}
                  </SortableContext>
                  </DndContext>
                </div>
              );
            })}
            {tpl.lines.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
                <p className="text-3xl mb-2">📋</p>
                <p className="font-semibold text-gray-700 text-[var(--fs-sm)]">No tasks yet</p>
                <p className="text-[var(--fs-xs)] text-gray-400 mt-1">Add your first task to start using this template.</p>
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
          onSaved={async (msg, newLineId) => {
            setShowAddLine(false);
            setEditingLine(null);
            await load();
            if (msg) showToast(msg);
            if (newLineId) await offerAddToToday(newLineId);
          }}
          onBackgroundRefresh={() => { void load(true); }}
        />
      )}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={dismissToast} />}
      {confirmElement}
    </div>
  );
}

interface LineModalProps {
  tplId: number;
  line: TaskTemplateLine | null;
  onClose: () => void;
  /** `createdLineId` is set only when this save CREATED a task — the parent
   *  uses it to offer adding it to today's already-running list. */
  onSaved: (toastMessage?: string, createdLineId?: number) => Promise<void>;
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

function LineModal({ tplId, line, onClose, onSaved, onBackgroundRefresh }: LineModalProps) {
  const [name, setName]               = useState(line?.name ?? '');
  const [dayPart, setDayPart]         = useState<DayPart>(line?.day_part ?? 'opening');
  const [deadline, setDeadline]       = useState(floatToHHMM(line?.deadline_time));
  const [photoRequired, setPhotoReq]  = useState(line?.photo_required ?? false);
  const [photoInstructions, setPhotoInstr] = useState(line?.photo_instructions ?? '');
  const [managerNote, setManagerNote] = useState(line?.manager_note ?? '');
  const [moduleLink, setModuleLink]   = useState<ModuleLink>(line?.module_link_type ?? 'none');
  // One subtask array carries both plain subtasks and setup-guide pins (pin_x/pin_y/photo/item).
  const [subtasks, setSubtasks]       = useState<EditorSubtask[]>(
    line?.subtasks.map(s => ({ id: s.id, name: s.name, pin_x: s.pin_x, pin_y: s.pin_y, pin_photo_seq: s.pin_photo_seq, item_id: s.item_id })) ?? [],
  );
  const [recurrence, setRecurrence]   = useState<RecurrenceRule>(line?.recurrence ?? defaultRecurrence());
  const [attachments, setAttachments] = useState<TaskAttachment[]>(line?.attachments ?? []);
  const [pendingAtts, setPendingAtts] = useState<PendingAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // ── Guided tutorial (replaces the retired inline "setup guide") ─────────────
  // The old setup-guide CREATION path is gone: is_setup_guide is now pinned false
  // so every line saves as a normal task. The photo/seq state below is kept ONLY
  // so the save function's (now unreachable) setup-guide branches keep type-
  // checking without rewriting the save flow — none of it ever becomes active.
  // A line's optional how-to now lives in a separate GuidedTutorialEditor (its own
  // API), opened per already-saved line via `guideEditorOpen` below.
  const [isSetupGuide] = useState(false);
  // The task's linked guide is managed by <GuidePicker/> below (its own API);
  // this modal just refreshes the list behind it via onBackgroundRefresh.
  const [photos, setPhotos] = useState<EditorPhoto[]>(
    (line?.setup_photo_seqs ?? []).map(seq => ({
      seq,
      url: `/api/tasks/templates/${tplId}/lines/${line!.id}/setup-photo?seq=${seq}`,
    })),
  );
  const [removedSeqs] = useState<number[]>([]);
  const [photoBusy] = useState(0);
  // New lines: remember the id created by the first successful save, so a retry
  // after a failed upload PATCHes instead of POSTing a duplicate task.
  const [createdLineId, setCreatedLineId] = useState<number | null>(null);
  // A guide chosen on the ADD-task form (before the task exists). It's linked to
  // the task right after it's created on save. For an already-saved line, the
  // live <GuidePicker/> below handles linking directly.
  const [pendingGuide, setPendingGuide] = useState<{ id: number; name: string } | null>(null);
  const [guidePicking, setGuidePicking] = useState(false);

  // Set when the manager dismisses the modal. A save already in flight then skips
  // its onSaved (which refreshes the list and closes the CURRENTLY open modal), so
  // a dismissed task's late-completing save can't close a DIFFERENT task the
  // manager has since opened. Dismissal stays available during a save (no lockout
  // if a request hangs); the write still commits server-side, we just don't
  // reach across to a modal that has moved on.
  const closedRef = useRef(false);
  const handleClose = () => { closedRef.current = true; onClose(); };

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
        manager_note: richTextToPlain(managerNote) ? managerNote.trim() : null,
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

      // Link a guide picked on the ADD-task form to the just-created task. The
      // task is already saved, so a link failure must not fail the save — it can
      // be re-linked by reopening the task (the live GuidePicker handles it).
      if (!existingId && lineId && pendingGuide) {
        try {
          await fetch(`/api/tasks/templates/${tplId}/lines/${lineId}/guide-link`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guide_id: pendingGuide.id }),
          });
          setPendingGuide(null);
        } catch { /* task saved; guide link can be added by reopening */ }
      }

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
      // Discriminate on the `line` PROP, not existingId: if a first Save created
      // the task but its photo upload failed, createdLineId is already set, so
      // existingId would be truthy on the retry and the offer would never appear
      // for a task that genuinely is new. Matches `baseMsg`'s own test above.
      await onSaved(`${baseMsg}${fileNote}${failNote}${photoNote}`, line ? undefined : lineId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSubmitting(false);
    }
  }

  return (
    <>
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={handleClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800 text-[var(--fs-lg)] px-5 pt-5 pb-3 flex-shrink-0">{line ? 'Edit task' : 'Add task'}</h2>
        <div className="flex-1 overflow-y-auto px-5 space-y-3 min-h-0">
          {/* Freeze EVERY control while a save is in flight: fieldset[disabled]
              natively disables all descendant inputs/selects/buttons, so no
              mid-save edit — e.g. unchecking Setup guide to reach the plain
              subtask list — can mutate state the submit already snapshotted. */}
          <fieldset disabled={submitting} className="space-y-3 min-w-0 border-0 p-0 m-0">
          <div>
            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Inspect restrooms"
              className="w-full px-3 py-2 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Section</label>
              <select value={dayPart} onChange={e => setDayPart(e.target.value as DayPart)}
                className="w-full px-3 py-2 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500">
                {DAY_PART_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-baseline justify-between text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">
                <span>Deadline</span>
                <span className="text-[10px] font-medium normal-case tracking-normal text-gray-400">optional</span>
              </label>
              <div className="flex items-center gap-2">
                <input type="time" value={deadline} onChange={e => setDeadline(e.target.value)}
                  className="flex-1 px-3 py-2 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500" />
                {deadline && (
                  <button type="button" onClick={() => setDeadline('')}
                    className="text-[var(--fs-xs)] font-semibold text-gray-500 hover:text-red-600 px-2 py-1 rounded-md hover:bg-gray-100">
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[var(--fs-xs)] text-gray-400 mt-1">
                Leave empty if it just needs to be done sometime during the {DAY_PART_OPTIONS.find(o => o.value === dayPart)?.label.toLowerCase()} section.
              </p>
            </div>
          </div>
          <div>
            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Module link</label>
            <select value={moduleLink} onChange={e => setModuleLink(e.target.value as ModuleLink)}
              className="w-full px-3 py-2 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500">
              {MODULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[var(--fs-sm)]">
            <input type="checkbox" checked={photoRequired} onChange={e => setPhotoReq(e.target.checked)} />
            Photo required
          </label>
          {photoRequired && (
            <div>
              <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Photo instructions (optional)</label>
              <textarea
                value={photoInstructions}
                onChange={e => setPhotoInstr(e.target.value)}
                placeholder="e.g. Take picture of the toilet bowl showing the connectors/screws"
                rows={2}
                className="w-full px-3 py-2 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-[var(--fs-xs)] text-gray-400 mt-1">Shown to staff above the photo upload button.</p>
            </div>
          )}
          <div>
            <label className="flex items-baseline justify-between text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">
              <span>Note for staff</span>
              <span className="text-[10px] font-medium normal-case tracking-normal text-gray-400">optional</span>
            </label>
            <RichTextEditor
              value={toEditorHtml(managerNote)}
              onChange={setManagerNote}
              placeholder="e.g. Check the walk-in AND the dry store. Order if under 2 trays."
              minHeight={72}
              // contenteditable ignores the wrapping fieldset[disabled], so it
              // has to be frozen explicitly — otherwise a keystroke during a
              // save is wiped by the re-hydrate and "Saved." claims otherwise.
              disabled={submitting}
            />
            <p className="text-[var(--fs-xs)] text-gray-400 mt-1">
              Shown to staff every day this task runs, when they open it.
              {richTextToPlain(managerNote).length > MAX_MANAGER_NOTE - 100 && (
                <span className="text-gray-500"> · {MAX_MANAGER_NOTE - richTextToPlain(managerNote).length} characters left</span>
              )}
            </p>
          </div>
          <div>
            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Subtasks</label>
            <div className="space-y-1.5">
              {subtasks.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input value={s.name} onChange={e => setSubtasks(prev => prev.map((p, idx) => idx === i ? { ...p, name: e.target.value } : p))}
                    placeholder="Subtask name"
                    className="flex-1 px-3 py-2 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <button onClick={() => setSubtasks(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-[var(--fs-xs)] text-red-500 hover:text-red-600 px-2">Remove</button>
                </div>
              ))}
              <button onClick={() => setSubtasks(prev => [...prev, { name: '', pin_x: 0, pin_y: 0, pin_photo_seq: 0 }])}
                className="text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800">
                + Add subtask
              </button>
            </div>
          </div>

          {/* Guided tutorial — link a REUSABLE library guide. Once the task
              exists (saved, or created this session) the live GuidePicker handles
              linking; on a brand-new task you can still pick one now and it links
              when you save. */}
          {(line?.id ?? createdLineId) ? (
            <GuidePicker
              templateId={tplId}
              lineId={(line?.id ?? createdLineId) as number}
              taskName={name}
              onChanged={onBackgroundRefresh}
            />
          ) : (
            <div>
              <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Guided tutorial</label>
              {pendingGuide ? (
                <div className="rounded-lg border border-gray-200 bg-white p-3 flex items-center gap-2">
                  <span className="text-[var(--fs-lg)] leading-none" aria-hidden="true">📖</span>
                  <span className="min-w-0 flex-1 text-[var(--fs-sm)] font-semibold text-gray-800 truncate">{pendingGuide.name}</span>
                  <button type="button" onClick={() => setPendingGuide(null)} className="text-[var(--fs-xs)] font-semibold text-red-600 hover:text-red-700">Remove</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setGuidePicking(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-[var(--fs-sm)] font-semibold text-gray-700 hover:bg-gray-50"
                >
                  📖 Link a guide
                </button>
              )}
              <p className="text-[var(--fs-xs)] text-gray-400 mt-1">Optional — a step-by-step how-to. It links when you save the task.</p>
            </div>
          )}
          <div>
            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Schedule</label>
            <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
          </div>
          <div>
            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">Reference files · quick single files</label>
            <p className="text-[var(--fs-xs)] text-gray-400 mb-1.5">One-off PDFs or images to open. For a step-by-step how-to, use the guided tutorial above.</p>
            <AttachmentList
              attachments={attachments}
              canDelete
              onDeleted={(id) => setAttachments(prev => prev.filter(a => a.id !== id))}
              compact
            />
            {pendingAtts.length > 0 && (
              <ul className="mt-1 space-y-1">
                {pendingAtts.map(p => (
                  <li key={p.tempId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-[var(--fs-xs)]">
                    <span>📎</span>
                    <span className="flex-1 min-w-0 truncate text-gray-800">{p.name}</span>
                    <span className="text-[10px] text-gray-500 flex-shrink-0">will upload on save</span>
                    <button onClick={() => removePending(p.tempId)} className="text-[var(--fs-xs)] text-red-500 hover:text-red-600 flex-shrink-0">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {/* accept="" because this field takes a PDF **or** an image, and
                DropZone filters on "image/" by default — it would have silently
                rejected exactly the PDFs the button offers. */}
            <DropZone onFiles={(fs) => { if (fs[0] && !uploadingFile) uploadAttachment(fs[0]); }}
              accept="" disabled={uploadingFile} hint="Drop the file here">
            <label className="mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 bg-green-50 border-2 border-dashed border-green-600 rounded-lg text-[var(--fs-xs)] font-semibold text-green-800 cursor-pointer hover:bg-green-100">
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
            </DropZone>
          </div>
          </fieldset>
          {error && <p className="text-[var(--fs-xs)] text-red-600 font-semibold">{error}</p>}
          <div className="h-2" />
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-white">
          <button onClick={handleClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-[var(--fs-sm)] font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={submitting || photoBusy > 0 || uploadingFile} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-[var(--fs-sm)] font-semibold hover:bg-green-700 disabled:opacity-50">
            {submitting ? 'Saving…' : photoBusy > 0 ? 'Processing photo…' : uploadingFile ? 'Reading file…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
    {guidePicking && (
      <GuideAttachModal
        taskName={name}
        currentGuideId={pendingGuide?.id ?? null}
        onClose={() => setGuidePicking(false)}
        onPick={(g) => { setPendingGuide(g); setGuidePicking(false); }}
        onCreated={(id, nm) => { setPendingGuide({ id, name: nm }); setGuidePicking(false); }}
      />
    )}
    </>
  );
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, EmptyState, SectionTitle, Sheet, Spinner } from '@/components/shifts/ui';
import { currentWeekKey, offsetWeekKey, weekKeyDays } from '@/lib/shifts-time';
import type { ShiftPattern, ShiftPatternLine, PublishRunState } from '@/types/shifts';

/**
 * Patterns & publishing — manager screen (behind the Planning gear).
 * Build a reusable weekly pattern, publish it into a week with a staff-selection
 * deadline, and manage published weeks (extend / reopen / finalize). All shifts
 * become plain planning.slot records; department + min-skill use the existing
 * portal overrides. Company-scoped to the header switcher.
 */

interface PatternManagerProps {
  companyId: number | null;
  isManager?: boolean;
  employeeId?: number | null;
  onBack: () => void;
  onHome: () => void;
}

interface NamedRef {
  id: number;
  name: string;
}

interface RunRow {
  id: number;
  companyId: number;
  patternId: number | null;
  weekKey: string;
  selectDeadline: string;
  state: PublishRunState;
  createdAt: string;
}

interface LineForm {
  weekday: number;
  start: string;
  end: string;
  roleId: number | null;
  departmentId: number | null;
  headcount: number;
  minSkill: '' | '2' | '3';
}

const WEEKDAYS: [number, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function weekLabel(weekKey: string): string {
  const days = weekKeyDays(weekKey);
  return `${fmtShort(days[0])} – ${fmtShort(days[6])}`;
}
function fmtDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function defaultDeadlineLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function emptyLine(): LineForm {
  return { weekday: 1, start: '16:00', end: '22:00', roleId: null, departmentId: null, headcount: 1, minSkill: '' };
}
function lineToForm(l: ShiftPatternLine): LineForm {
  return {
    weekday: l.weekday,
    start: l.startHHMM,
    end: l.endHHMM,
    roleId: l.roleId,
    departmentId: l.departmentId,
    headcount: l.headcount,
    minSkill: l.minSkill ?? '',
  };
}

const selectClass =
  'bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[var(--fs-sm)] font-semibold text-gray-900 outline-none focus:border-green-600 min-h-[44px]';
const primaryBtn =
  'w-full px-6 py-3.5 bg-green-600 text-white text-[var(--fs-md)] font-bold rounded-xl active:bg-green-700 disabled:opacity-50';

const STATE_BADGE: Record<PublishRunState, { variant: 'green' | 'gray' | 'blue'; label: string }> = {
  open: { variant: 'green', label: 'Open for picking' },
  locked: { variant: 'gray', label: 'Locked' },
  finalized: { variant: 'blue', label: 'Finalized' },
};

export default function PatternManager({ companyId, onBack }: PatternManagerProps) {
  const [roles, setRoles] = useState<NamedRef[]>([]);
  const [departments, setDepartments] = useState<NamedRef[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Editor state: null = closed; otherwise the pattern being built/edited.
  const [editor, setEditor] = useState<{ id: number | null; name: string; lines: LineForm[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Publish sheet state.
  const [publishFor, setPublishFor] = useState<ShiftPattern | null>(null);
  const [publishWeek, setPublishWeek] = useState<string>(currentWeekKey());
  const [publishDeadline, setPublishDeadline] = useState<string>(defaultDeadlineLocal());
  const [publishError, setPublishError] = useState<string | null>(null);

  // Run detail sheet (with gaps + transitions).
  const [runDetail, setRunDetail] = useState<{ run: RunRow; gaps: { open: number; total: number } } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [rosterRes, patternsRes, runsRes] = await Promise.all([
        fetch(`/api/shifts/roster?company_id=${companyId}`),
        fetch(`/api/shifts/patterns?company_id=${companyId}`),
        fetch(`/api/shifts/runs?company_id=${companyId}`),
      ]);
      const roster = await rosterRes.json();
      const pat = await patternsRes.json();
      const run = await runsRes.json();
      if (!patternsRes.ok) throw new Error(pat.error || 'Could not load patterns');
      setRoles(Array.isArray(roster.roles) ? roster.roles : []);
      setDepartments(Array.isArray(roster.departments) ? roster.departments : []);
      setPatterns(Array.isArray(pat.patterns) ? pat.patterns : []);
      setRuns(Array.isArray(run.runs) ? run.runs : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Editor actions ---
  function openNew() {
    setEditorError(null);
    setEditor({ id: null, name: '', lines: [emptyLine()] });
  }
  function openEdit(p: ShiftPattern) {
    setEditorError(null);
    setEditor({ id: p.id, name: p.name, lines: p.lines.length ? p.lines.map(lineToForm) : [emptyLine()] });
  }
  function patchLine(i: number, patch: Partial<LineForm>) {
    setEditor(e => (e ? { ...e, lines: e.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) } : e));
  }
  function addLine() {
    setEditor(e => (e ? { ...e, lines: [...e.lines, emptyLine()] } : e));
  }
  function removeLine(i: number) {
    setEditor(e => (e ? { ...e, lines: e.lines.filter((_, idx) => idx !== i) } : e));
  }

  async function saveEditor() {
    if (!editor || !companyId) return;
    const name = editor.name.trim();
    if (!name) {
      setEditorError('Give the pattern a name');
      return;
    }
    if (editor.lines.length === 0) {
      setEditorError('Add at least one shift');
      return;
    }
    for (const l of editor.lines) {
      if (l.start === l.end) {
        setEditorError('Each shift must be longer than zero hours');
        return;
      }
    }
    setSaving(true);
    setEditorError(null);
    const payloadLines = editor.lines.map(l => ({
      weekday: l.weekday,
      start: l.start,
      end: l.end,
      role_id: l.roleId,
      department_id: l.departmentId,
      headcount: l.headcount,
      min_skill: l.minSkill === '' ? null : l.minSkill,
    }));
    try {
      const url = editor.id === null ? '/api/shifts/patterns' : `/api/shifts/patterns/${editor.id}`;
      const method = editor.id === null ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name, lines: payloadLines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEditor(null);
      showToast('Pattern saved');
      await load();
    } catch (err: unknown) {
      setEditorError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function deletePattern(p: ShiftPattern) {
    if (!companyId) return;
    if (!window.confirm(`Delete the pattern “${p.name}”? Shifts already published stay put.`)) return;
    try {
      const res = await fetch(`/api/shifts/patterns/${p.id}?company_id=${companyId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast('Pattern deleted');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    }
  }

  // --- Publish actions ---
  function openPublish(p: ShiftPattern) {
    setPublishError(null);
    setPublishWeek(offsetWeekKey(currentWeekKey(), 1)); // default: next week
    setPublishDeadline(defaultDeadlineLocal());
    setPublishFor(p);
  }
  async function doPublish() {
    if (!publishFor || !companyId) return;
    const ms = Date.parse(publishDeadline);
    if (!Number.isFinite(ms) || ms <= Date.now()) {
      setPublishError('Pick a deadline in the future');
      return;
    }
    setSaving(true);
    setPublishError(null);
    try {
      const res = await fetch(`/api/shifts/patterns/${publishFor.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          week: publishWeek,
          select_deadline: new Date(ms).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPublishFor(null);
      showToast(`Published ${data.created} shifts — staff can choose until ${fmtDeadline(new Date(ms).toISOString())}`);
      await load();
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : 'Could not publish');
    } finally {
      setSaving(false);
    }
  }

  // --- Run actions ---
  async function openRun(run: RunRow) {
    if (!companyId) return;
    setRunDetail({ run, gaps: { open: 0, total: 0 } });
    try {
      const res = await fetch(`/api/shifts/runs/${run.id}?company_id=${companyId}`);
      const data = await res.json();
      if (res.ok) setRunDetail({ run: data.run, gaps: data.gaps });
    } catch {
      /* keep the row-level info if the detail fetch fails */
    }
  }
  async function transition(run: RunRow, action: 'extend' | 'reopen' | 'finalize', deadlineLocal?: string) {
    if (!companyId) return;
    const body: Record<string, unknown> = { company_id: companyId, action };
    if (action !== 'finalize') {
      const ms = deadlineLocal ? Date.parse(deadlineLocal) : NaN;
      if (!Number.isFinite(ms) || ms <= Date.now()) {
        showToast('Pick a deadline in the future');
        return;
      }
      body.select_deadline = new Date(ms).toISOString();
    }
    try {
      const res = await fetch(`/api/shifts/runs/${run.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRunDetail(null);
      showToast(action === 'finalize' ? 'Week finalized' : 'Deadline updated');
      await load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not update');
    }
  }

  if (!companyId || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="Planning" title="Patterns & publishing" showBack onBack={onBack} />
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Patterns & publishing" showBack onBack={onBack} />

      <div className="pb-32 max-w-xl mx-auto w-full">
        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-base)] text-red-700">
            {error}
          </div>
        )}

        <SectionTitle>Weekly patterns</SectionTitle>
        <div className="px-4">
          {patterns.length === 0 ? (
            <EmptyState
              icon="🗓️"
              title="No patterns yet"
              body="Build your usual week once, then publish it into any week."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {patterns.map(p => {
                const total = p.lines.reduce((s, l) => s + l.headcount, 0);
                return (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-3.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{p.name}</div>
                        <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">
                          {p.lines.length} shift{p.lines.length === 1 ? '' : 's'} · {total} {total === 1 ? 'person' : 'people'} / week
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => openPublish(p)}
                        className="flex-1 px-3 py-2.5 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-lg active:bg-green-700"
                      >
                        Publish
                      </button>
                      <button
                        onClick={() => openEdit(p)}
                        className="px-4 py-2.5 border border-gray-200 text-gray-700 text-[var(--fs-sm)] font-semibold rounded-lg active:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deletePattern(p)}
                        aria-label="Delete pattern"
                        className="px-3 py-2.5 border border-gray-200 text-red-600 text-[var(--fs-sm)] font-semibold rounded-lg active:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={openNew} className={`${primaryBtn} mt-3`}>
            + New pattern
          </button>
        </div>

        <SectionTitle>Published weeks</SectionTitle>
        <div className="px-4">
          {runs.length === 0 ? (
            <p className="text-[var(--fs-sm)] text-gray-400 px-1 pb-2">
              Nothing published yet. Publish a pattern above to open a week for staff to pick.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {runs.map(run => {
                const badge = STATE_BADGE[run.state];
                return (
                  <button
                    key={run.id}
                    onClick={() => openRun(run)}
                    className="w-full text-left bg-white rounded-xl border border-gray-200 p-3.5 active:bg-gray-50"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900">Week of {weekLabel(run.weekKey)}</div>
                        <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">Choose by {fmtDeadline(run.selectDeadline)}</div>
                      </div>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pattern editor */}
      <Sheet open={editor !== null} onClose={() => setEditor(null)}>
        {editor && (
          <div>
            <h2 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-3 px-1">
              {editor.id === null ? 'New pattern' : 'Edit pattern'}
            </h2>
            <input
              type="text"
              value={editor.name}
              maxLength={40}
              onChange={e => setEditor(prev => (prev ? { ...prev, name: e.target.value } : prev))}
              placeholder="Pattern name (e.g. Normal Week)"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 h-12 text-[var(--fs-md)] font-semibold text-gray-900 outline-none focus:border-green-600 mb-3"
            />

            <div className="flex flex-col gap-2.5">
              {editor.lines.map((l, i) => (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl p-2.5">
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Weekday"
                      className={selectClass}
                      value={l.weekday}
                      onChange={e => patchLine(i, { weekday: Number(e.target.value) })}
                    >
                      {WEEKDAYS.map(([n, lbl]) => (
                        <option key={n} value={n}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Start time"
                      type="time"
                      value={l.start}
                      onChange={e => patchLine(i, { start: e.target.value })}
                      className={selectClass}
                    />
                    <input
                      aria-label="End time"
                      type="time"
                      value={l.end}
                      onChange={e => patchLine(i, { end: e.target.value })}
                      className={selectClass}
                    />
                    <button
                      onClick={() => removeLine(i)}
                      aria-label="Remove shift"
                      className="ml-auto w-9 h-9 rounded-lg text-red-600 flex items-center justify-center active:bg-red-50 flex-shrink-0"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <select
                      aria-label="Role"
                      className={selectClass}
                      value={l.roleId ?? ''}
                      onChange={e => patchLine(i, { roleId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Any role</option>
                      {roles.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    {departments.length > 0 && (
                      <select
                        aria-label="Station"
                        className={selectClass}
                        value={l.departmentId ?? ''}
                        onChange={e => patchLine(i, { departmentId: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">No station</option>
                        {departments.map(d => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      aria-label="Minimum skill"
                      className={selectClass}
                      value={l.minSkill}
                      onChange={e => patchLine(i, { minSkill: e.target.value as '' | '2' | '3' })}
                    >
                      <option value="">Anyone</option>
                      <option value="2">Level 2+</option>
                      <option value="3">Level 3</option>
                    </select>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-[var(--fs-xs)] font-semibold text-gray-500 uppercase tracking-wide">People</span>
                      <input
                        aria-label="Headcount"
                        type="number"
                        min={1}
                        max={20}
                        value={l.headcount}
                        onChange={e =>
                          patchLine(i, { headcount: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })
                        }
                        className="w-14 bg-white border border-gray-200 rounded-lg px-2 py-2 text-[var(--fs-sm)] font-bold text-gray-900 outline-none focus:border-green-600 min-h-[44px] text-center"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addLine}
              className="w-full mt-2.5 px-4 py-2.5 border border-dashed border-gray-300 text-gray-600 text-[var(--fs-sm)] font-semibold rounded-xl active:bg-gray-50"
            >
              + Add shift
            </button>

            {editorError && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-base)] text-red-700">
                {editorError}
              </div>
            )}

            <button onClick={saveEditor} disabled={saving} className={`${primaryBtn} mt-3`}>
              {saving ? 'Saving…' : 'Save pattern'}
            </button>
          </div>
        )}
      </Sheet>

      {/* Publish sheet */}
      <Sheet open={publishFor !== null} onClose={() => setPublishFor(null)}>
        {publishFor && (
          <div>
            <h2 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1 px-1">Publish “{publishFor.name}”</h2>
            <p className="text-[var(--fs-sm)] text-gray-500 mb-3 px-1">
              Turns the pattern into open shifts staff can pick, with a deadline.
            </p>

            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide px-1 mb-1.5">
              Which week
            </label>
            <div className="flex flex-col gap-2 mb-4">
              {[currentWeekKey(), offsetWeekKey(currentWeekKey(), 1), offsetWeekKey(currentWeekKey(), 2)].map(wk => (
                <button
                  key={wk}
                  onClick={() => setPublishWeek(wk)}
                  className={`px-3.5 py-3 rounded-xl border text-left text-[var(--fs-md)] font-semibold ${
                    publishWeek === wk
                      ? 'border-green-600 bg-green-50 text-green-800'
                      : 'border-gray-200 bg-white text-gray-900 active:bg-gray-50'
                  }`}
                >
                  Week of {weekLabel(wk)}
                  {wk === currentWeekKey() && <span className="text-gray-400 font-medium"> · this week</span>}
                </button>
              ))}
            </div>

            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide px-1 mb-1.5">
              Staff must choose by
            </label>
            <input
              type="datetime-local"
              value={publishDeadline}
              onChange={e => setPublishDeadline(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 h-12 text-[var(--fs-md)] font-semibold text-gray-900 outline-none focus:border-green-600 mb-3"
            />

            {publishError && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-base)] text-red-700">
                {publishError}
              </div>
            )}

            <button onClick={doPublish} disabled={saving} className={primaryBtn}>
              {saving ? 'Publishing…' : 'Publish this week'}
            </button>
          </div>
        )}
      </Sheet>

      {/* Run detail sheet */}
      <Sheet open={runDetail !== null} onClose={() => setRunDetail(null)}>
        {runDetail && (
          <div>
            <h2 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1 px-1">
              Week of {weekLabel(runDetail.run.weekKey)}
            </h2>
            <div className="flex items-center gap-2 px-1 mb-3">
              <Badge variant={STATE_BADGE[runDetail.run.state].variant}>{STATE_BADGE[runDetail.run.state].label}</Badge>
              <span className="text-[var(--fs-sm)] text-gray-500">
                {runDetail.gaps.total - runDetail.gaps.open} of {runDetail.gaps.total} filled
                {runDetail.gaps.open > 0 ? ` · ${runDetail.gaps.open} still open` : ''}
              </span>
            </div>
            <p className="text-[var(--fs-sm)] text-gray-500 px-1 mb-4">Choose-by deadline: {fmtDeadline(runDetail.run.selectDeadline)}</p>

            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide px-1 mb-1.5">
              Move / extend the deadline
            </label>
            <input
              type="datetime-local"
              defaultValue={defaultDeadlineLocal()}
              onChange={e => setPublishDeadline(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 h-12 text-[var(--fs-md)] font-semibold text-gray-900 outline-none focus:border-green-600 mb-2"
            />
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => transition(runDetail.run, runDetail.run.state === 'locked' ? 'reopen' : 'extend', publishDeadline)}
                className="flex-1 px-3 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
              >
                {runDetail.run.state === 'locked' ? 'Reopen with this deadline' : 'Update deadline'}
              </button>
            </div>
            {runDetail.run.state !== 'finalized' && (
              <button
                onClick={() => transition(runDetail.run, 'finalize')}
                className="w-full px-3 py-3 border border-gray-200 text-gray-700 text-[var(--fs-sm)] font-semibold rounded-xl active:bg-gray-50"
              >
                Finalize this week (stop changes)
              </button>
            )}
          </div>
        )}
      </Sheet>

      {toast && (
        <div className="fixed bottom-10 left-1/2 z-[110] -translate-x-1/2 rounded-full bg-gray-900 px-5 py-3 text-[var(--fs-sm)] font-semibold text-white shadow-lg max-w-[90vw] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}

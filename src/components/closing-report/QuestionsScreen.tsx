'use client';

// Closing Report — the manager's question builder. Per-department tabs;
// add / edit / delete / drag-reorder questions; mark which answers count as a
// problem; a one-tap starter set for an empty department; the morning-email
// toggle. Changes apply from the next report — submitted reports never change.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import AppHeader from '@/components/ui/AppHeader';
import Toast from '@/components/ui/Toast';
import useConfirm from '@/components/ui/useConfirm';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { CompanyPill } from '@/components/ui/CompanyPill';
import DragRow from '@/components/ui/DragRow';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { api, QTYPE_LABEL, type ApiQuestion, type QType } from './common';

interface DeptsPayload {
  departments: { id: number; name: string }[];
  all_departments?: { id: number; name: string }[];
}

interface SettingsPayload { missing_email_enabled: boolean }

interface EditorState {
  id: number | null; // null = new
  text: string;
  qtype: QType;
  options: string[];
  problem_values: string[];
}

const EMPTY_EDITOR: EditorState = { id: null, text: '', qtype: 'yes_no', options: [], problem_values: [] };

export default function QuestionsScreen() {
  const { confirm, confirmElement } = useConfirm();
  const [allDepts, setAllDepts] = useState<{ id: number; name: string }[]>([]);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0); // bumping re-runs the questions fetch even when deptId is unchanged (retry)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const token = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const loadDepts = useCallback(async () => {
    const my = ++token.current;
    setLoading(true);
    setLoadError('');
    try {
      // Fetch BOTH before any state update: setting deptId triggers the
      // questions fetch, which bumps the shared token — a settings response
      // arriving after that would be dropped as stale and the toggle never shows.
      const d = await api<DeptsPayload>('/api/closing-report/departments');
      const s = await api<SettingsPayload>('/api/closing-report/settings');
      if (my !== token.current) return;
      const all = d.all_departments || d.departments;
      setAllDepts(all);
      setSettings(s);
      setDeptId((prev) => (prev != null && all.some((x) => x.id === prev) ? prev : all[0]?.id ?? null));
      if (all.length === 0) setLoading(false);
    } catch (e) {
      if (my !== token.current) return;
      setLoadError(e instanceof Error ? e.message : 'Could not load.');
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDepts(); }, [loadDepts]);

  const loadQuestions = useCallback(async (dept: number) => {
    const my = ++token.current;
    setLoading(true);
    setLoadError('');
    try {
      const q = await api<{ questions: ApiQuestion[] }>(`/api/closing-report/manage/questions?department_id=${dept}`);
      if (my !== token.current) return;
      setQuestions(q.questions);
    } catch (e) {
      if (my !== token.current) return;
      setLoadError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      if (my === token.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (deptId != null) loadQuestions(deptId);
  }, [deptId, reload, loadQuestions]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || deptId == null) return;
    const oldIndex = questions.findIndex((q) => q.id === active.id);
    const newIndex = questions.findIndex((q) => q.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(questions, oldIndex, newIndex);
    setQuestions(next); // optimistic — the list must move under the finger
    try {
      await api('/api/closing-report/manage/questions/reorder', {
        method: 'PUT',
        body: JSON.stringify({ department_id: deptId, ordered_ids: next.map((q) => q.id) }),
      });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Could not save the order.', type: 'error' });
      loadQuestions(deptId);
    }
  }

  async function saveEditor() {
    if (!editor || deptId == null || busy) return;
    setEditorError('');
    if (!editor.text.trim()) { setEditorError('The question needs some text.'); return; }
    if (editor.qtype === 'choice' && editor.options.filter((o) => o.trim()).length < 2) {
      setEditorError('A choose-one question needs at least two options.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        department_id: deptId,
        text: editor.text,
        qtype: editor.qtype,
        options: editor.options.filter((o) => o.trim()),
        problem_values: editor.problem_values,
      };
      if (editor.id == null) {
        const res = await api<{ question: ApiQuestion }>('/api/closing-report/manage/questions', {
          method: 'POST', body: JSON.stringify(body),
        });
        setQuestions((prev) => [...prev, res.question]);
        setToast({ msg: 'Question added — applies from the next report', type: 'success' });
      } else {
        const res = await api<{ question: ApiQuestion }>(`/api/closing-report/manage/questions/${editor.id}`, {
          method: 'PATCH', body: JSON.stringify(body),
        });
        setQuestions((prev) => prev.map((q) => (q.id === editor.id ? res.question : q)));
        setToast({ msg: 'Question updated — applies from the next report', type: 'success' });
      }
      setEditor(null);
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuestion(q: ApiQuestion) {
    const ok = await confirm({
      title: 'Delete this question?',
      message: `“${q.text}” is removed from future reports. Already-submitted reports keep their answers.`,
      confirmLabel: 'Delete question',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/api/closing-report/manage/questions/${q.id}`, { method: 'DELETE' });
      setQuestions((prev) => prev.filter((x) => x.id !== q.id));
      setToast({ msg: 'Question deleted', type: 'success' });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Could not delete.', type: 'error' });
    }
  }

  async function loadStarter() {
    if (deptId == null) return;
    try {
      const res = await api<{ questions: ApiQuestion[] }>('/api/closing-report/manage/questions/starter', {
        method: 'POST', body: JSON.stringify({ department_id: deptId }),
      });
      setQuestions(res.questions);
      setToast({ msg: 'Starter questions loaded — edit them any time', type: 'success' });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Could not load the starter set.', type: 'error' });
    }
  }

  async function toggleEmail() {
    if (!settings) return;
    const next = !settings.missing_email_enabled;
    setSettings({ missing_email_enabled: next }); // optimistic
    try {
      await api('/api/closing-report/settings', {
        method: 'PUT', body: JSON.stringify({ missing_email_enabled: next }),
      });
      setToast({
        msg: next ? 'Morning email ON — managers hear at 08:00 when a report is missing' : 'Morning email off',
        type: 'success',
      });
    } catch (e) {
      setSettings({ missing_email_enabled: !next });
      setToast({ msg: e instanceof Error ? e.message : 'Could not save.', type: 'error' });
    }
  }

  function toggleProblemValue(v: string) {
    setEditor((prev) => prev && ({
      ...prev,
      problem_values: prev.problem_values.includes(v)
        ? prev.problem_values.filter((x) => x !== v)
        : [...prev.problem_values, v],
    }));
  }

  const editorAllowedValues: { value: string; label: string }[] =
    editor?.qtype === 'yes_no' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
    : editor?.qtype === 'rating' ? ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))
    : editor?.qtype === 'choice' ? editor.options.filter((o) => o.trim()).map((o) => ({ value: o, label: o }))
    : [];

  return (
    <div className="max-w-lg mx-auto px-4 pb-24">
      <AppHeader
        supertitle="Closing Reports"
        title="Questions"
        subtitle="What every closing answers"
        backHref="/closing-report"
        action={<CompanyPill onSwitched={() => { setDeptId(null); loadDepts(); }} />}
      />

      {allDepts.length > 1 && (
        <div className="flex gap-2 mt-4 overflow-x-auto">
          {allDepts.map((d) => (
            <button
              key={d.id}
              onClick={() => setDeptId(d.id)}
              className={`flex-shrink-0 min-h-[40px] px-4 rounded-full border text-[13px] font-semibold ${
                deptId === d.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="text-center text-gray-400 text-sm py-12">Loading…</div>}

      {!loading && loadError && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center mt-4">
          <p className="text-[14px] text-gray-600">{loadError}</p>
          <button onClick={() => (deptId != null ? setReload((r) => r + 1) : loadDepts())} className="mt-3 min-h-[44px] px-6 rounded-full border border-gray-300 text-[14px] font-semibold text-gray-600">Try again</button>
        </div>
      )}

      {!loading && !loadError && deptId != null && (
        <div className="mt-4 space-y-3">
          {questions.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center">
              <div className="text-3xl mb-2" aria-hidden>🌙</div>
              <p className="text-[15px] font-semibold text-gray-800">No questions yet</p>
              <p className="text-[13.5px] text-gray-500 mt-1">Load a sensible starter set and tune it, or start from scratch.</p>
              <button onClick={loadStarter} className="mt-4 w-full min-h-[46px] rounded-xl bg-green-600 text-white text-[14px] font-bold active:scale-[0.98]">Load starter questions</button>
              <button onClick={() => { setEditor(EMPTY_EDITOR); setEditorError(''); }} className="mt-2 w-full min-h-[44px] rounded-xl border border-gray-300 text-[14px] font-semibold text-gray-600">Write my own</button>
            </div>
          ) : (
            <>
              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-1">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                    {questions.map((q) => (
                      <DragRow key={q.id} id={q.id} className="flex items-center gap-2.5 py-3 border-b border-gray-100 last:border-b-0">
                        {(handle) => (
                          <>
                            {handle}
                            <button onClick={() => { setEditor({ id: q.id, text: q.text, qtype: q.qtype, options: q.options, problem_values: q.problem_values }); setEditorError(''); }} className="flex-1 min-w-0 text-left">
                              <p className="text-[13.5px] font-semibold text-gray-900 leading-snug">{q.text}</p>
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                {QTYPE_LABEL[q.qtype]}
                                {q.qtype === 'choice' && q.options.length > 0 ? ` · ${q.options.join(' / ')}` : ''}
                              </p>
                              {q.problem_values.length > 0 && (
                                <span className="inline-block mt-1 text-[10.5px] font-bold text-red-600 bg-red-50 rounded-full px-2 py-0.5">
                                  {q.problem_values.map((v) => (v === 'yes' ? '“Yes”' : v === 'no' ? '“No”' : `“${v}”`)).join(', ')} = problem, note required
                                </span>
                              )}
                            </button>
                            <button onClick={() => deleteQuestion(q)} aria-label={`Delete “${q.text}”`} className="w-10 h-10 flex-shrink-0 rounded-lg border border-gray-200 text-gray-400 active:bg-gray-50">🗑</button>
                          </>
                        )}
                      </DragRow>
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
              <PrimaryButton onClick={() => { setEditor(EMPTY_EDITOR); setEditorError(''); }} className="w-full">＋ Add question</PrimaryButton>
              <p className="text-[12px] text-gray-400 text-center">Changes apply from the next report — submitted reports never change.</p>
            </>
          )}

          {settings && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-gray-900">Morning email if a report is missing</p>
                <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">Managers get an email at 08:00 listing departments that didn’t submit last night. Off by default.</p>
              </div>
              <button
                onClick={toggleEmail}
                role="switch"
                aria-checked={settings.missing_email_enabled}
                aria-label="Morning email if a report is missing"
                className={`relative flex-shrink-0 w-12 h-7 rounded-full transition-colors ${settings.missing_email_enabled ? 'bg-green-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${settings.missing_email_enabled ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
          )}
        </div>
      )}

      {editor && (
        <BottomSheet
          title={editor.id == null ? 'Add a question' : 'Edit question'}
          onClose={() => setEditor(null)}
          dismissOnBackdrop={false}
          footer={
            <PrimaryButton busy={busy} onClick={saveEditor} className="w-full">
              {editor.id == null ? 'Add question' : 'Save changes'}
            </PrimaryButton>
          }
        >
          <div className="space-y-4 pb-2">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">The question</label>
              <textarea
                value={editor.text}
                onChange={(e) => setEditor({ ...editor, text: e.target.value })}
                rows={2}
                placeholder="e.g. Is all equipment working?"
                className="w-full rounded-xl border-[1.5px] border-gray-200 bg-gray-50 focus:bg-white focus:border-green-600 focus:outline-none p-3 text-[14px]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">How is it answered?</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(QTYPE_LABEL) as QType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setEditor({ ...editor, qtype: t, options: t === 'choice' ? (editor.options.length ? editor.options : ['', '']) : [], problem_values: [] })}
                    className={`min-h-[44px] rounded-xl border-[1.5px] text-[13px] font-semibold ${
                      editor.qtype === t ? 'bg-green-50 border-green-600 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500'
                    }`}
                  >
                    {QTYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {editor.qtype === 'choice' && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">The options (in order)</label>
                <div className="space-y-2">
                  {editor.options.map((o, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={o}
                        onChange={(e) => {
                          const options = [...editor.options];
                          options[i] = e.target.value;
                          // Keep problem flags in step with a renamed option.
                          const problem_values = editor.problem_values.map((p) => (p === o ? e.target.value : p));
                          setEditor({ ...editor, options, problem_values });
                        }}
                        placeholder={`Option ${i + 1}`}
                        className="flex-1 min-h-[44px] rounded-xl border-[1.5px] border-gray-200 bg-gray-50 focus:bg-white focus:border-green-600 focus:outline-none px-3 text-[14px]"
                      />
                      {editor.options.length > 2 && (
                        <button
                          onClick={() => setEditor({
                            ...editor,
                            options: editor.options.filter((_, j) => j !== i),
                            problem_values: editor.problem_values.filter((p) => p !== o),
                          })}
                          aria-label={`Remove option ${i + 1}`}
                          className="w-11 h-11 flex-shrink-0 rounded-xl border border-gray-200 text-gray-400"
                        >✕</button>
                      )}
                    </div>
                  ))}
                </div>
                {editor.options.length < 8 && (
                  <button onClick={() => setEditor({ ...editor, options: [...editor.options, ''] })} className="mt-2 text-[13px] font-semibold text-green-700 min-h-[44px]">＋ Add an option</button>
                )}
              </div>
            )}

            {editor.qtype !== 'text' && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">Which answers count as a problem?</label>
                <p className="text-[12px] text-gray-500 mb-2">A problem answer turns red for managers and staff must add a note.</p>
                <div className="flex flex-wrap gap-2">
                  {editorAllowedValues.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => toggleProblemValue(value)}
                      className={`min-h-[40px] px-4 rounded-full border-[1.5px] text-[13px] font-semibold ${
                        editor.problem_values.includes(value)
                          ? 'bg-red-50 border-red-500 text-red-600'
                          : 'bg-gray-50 border-gray-200 text-gray-500'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {editorAllowedValues.length === 0 && (
                    <p className="text-[12.5px] text-gray-400">Write the options first, then mark the problem ones.</p>
                  )}
                </div>
              </div>
            )}

            {editorError && <p className="text-[13px] font-semibold text-red-600">{editorError}</p>}
          </div>
        </BottomSheet>
      )}

      {confirmElement}
      <Toast message={toast?.msg || ''} type={toast?.type || 'info'} visible={!!toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

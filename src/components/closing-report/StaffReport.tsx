'use client';

// Closing Report — the staff screen. Pick a department (auto when only one
// takes part), answer tonight's questions, submit. After submit everyone sees
// the read view; the submitter can correct it until 05:00, then it locks.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import Toast from '@/components/ui/Toast';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { CompanyPill } from '@/components/ui/CompanyPill';
import PhotoCaptureStrip from '@/components/inventory/PhotoCaptureStrip';
import ReportView from './ReportView';
import {
  ApiError, api, fmtNight, fmtTimeBerlin,
  OptionButtons, RatingButtons,
  type ApiQuestion, type ApiReport, type DeptEntry,
} from './common';

interface DeptsPayload {
  date: string;
  departments: DeptEntry[];
  can_review: boolean;
  can_manage: boolean;
}

interface ReportPayload {
  date: string;
  department_id: number;
  report: ApiReport | null;
  editable: boolean;
  can_edit: boolean;
  questions?: ApiQuestion[];
}

interface Draft {
  value: string;
  note: string;
  photos: string[];
}

export default function StaffReport() {
  const router = useRouter();
  const [depts, setDepts] = useState<DeptsPayload | null>(null);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const token = useRef(0);

  const loadDepts = useCallback(async () => {
    const my = ++token.current;
    setLoading(true);
    setLoadError('');
    try {
      const d = await api<DeptsPayload>('/api/closing-report/departments');
      if (my !== token.current) return;
      setDepts(d);
      // Auto-enter when exactly one department takes part.
      setDeptId((prev) => prev ?? (d.departments.length === 1 ? d.departments[0].id : null));
    } catch (e) {
      if (my !== token.current) return;
      setLoadError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      if (my === token.current) setLoading(false);
    }
  }, []);

  useEffect(() => { loadDepts(); }, [loadDepts]);

  const loadReport = useCallback(async (dept: number) => {
    const my = ++token.current;
    setLoading(true);
    setLoadError('');
    try {
      const p = await api<ReportPayload>(`/api/closing-report/report?department_id=${dept}`);
      if (my !== token.current) return;
      setPayload(p);
      setEditing(false);
      setErrors({});
      setFormError('');
      if (!p.report) {
        const init: Record<number, Draft> = {};
        for (const q of p.questions || []) init[q.id] = { value: '', note: '', photos: [] };
        setDrafts(init);
      }
    } catch (e) {
      if (my !== token.current) return;
      setLoadError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      if (my === token.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (deptId != null) loadReport(deptId);
  }, [deptId, loadReport]);

  const deptName = depts?.departments.find((d) => d.id === deptId)?.name || '';
  const night = payload?.date || depts?.date || '';

  // Questions for the form: the live template when new, the report's own
  // snapshot when correcting (a template edit overnight can't change tonight's rules).
  const questions: ApiQuestion[] = editing && payload?.report
    ? payload.report.answers
        .filter((a) => a.question_id != null)
        .map((a) => ({
          id: a.question_id as number, position: a.position, text: a.question_text,
          qtype: a.qtype, options: a.options, problem_values: a.problem_values,
        }))
    : payload?.questions || [];

  function startEditing() {
    if (!payload?.report) return;
    const init: Record<number, Draft> = {};
    for (const a of payload.report.answers) {
      if (a.question_id != null) {
        init[a.question_id] = { value: a.value, note: a.note || '', photos: a.photos };
      }
    }
    setDrafts(init);
    setErrors({});
    setFormError('');
    setEditing(true);
  }

  function setDraft(qid: number, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [qid]: { ...(prev[qid] || { value: '', note: '', photos: [] }), ...patch } }));
    setErrors((prev) => {
      if (!(qid in prev)) return prev;
      const next = { ...prev };
      delete next[qid];
      return next;
    });
  }

  async function submit() {
    if (busy || !deptId || !payload) return;
    // Client-side mirror of the server rules, for instant feedback.
    const localErrors: Record<number, string> = {};
    for (const q of questions) {
      const d = drafts[q.id] || { value: '', note: '', photos: [] };
      if (q.qtype !== 'text' && !d.value) localErrors[q.id] = 'Please answer this question.';
      else if (d.value && q.problem_values.includes(d.value) && !d.note.trim()) {
        localErrors[q.id] = 'Please describe what happened — the manager needs the story, not just the answer.';
      }
    }
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      setFormError('Please answer the highlighted questions first.');
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      const answers = questions.map((q) => {
        const d = drafts[q.id] || { value: '', note: '', photos: [] };
        const flagged = !!d.value && q.problem_values.includes(d.value);
        return {
          question_id: q.id,
          value: d.value,
          note: flagged ? d.note : undefined,
          photos: flagged ? d.photos : undefined,
        };
      });
      if (editing && payload.report) {
        await api(`/api/closing-report/report/${payload.report.id}`, {
          method: 'PUT',
          body: JSON.stringify({ answers }),
        });
        setToast({ msg: 'Report updated ✓', type: 'success' });
      } else {
        await api('/api/closing-report/report', {
          method: 'POST',
          body: JSON.stringify({ department_id: deptId, answers }),
        });
        setToast({ msg: 'Report submitted ✓', type: 'success' });
      }
      await loadReport(deptId);
      await loadDepts();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && e.errors) {
        setErrors(e.errors);
        setFormError(e.message);
      } else if (e instanceof ApiError && e.status === 409) {
        setToast({ msg: e.message, type: 'error' });
        await loadReport(deptId);
      } else {
        setToast({ msg: e instanceof Error ? e.message : 'Could not save.', type: 'error' });
      }
    } finally {
      setBusy(false);
    }
  }

  const showForm = !!payload && (!payload.report || editing);
  const managerLinks = depts?.can_review && (
    <div className="flex gap-2 mt-4">
      <button onClick={() => router.push('/closing-report/manager')} className="flex-1 min-h-[44px] rounded-xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-600 active:bg-gray-50">Review</button>
      <button onClick={() => router.push('/closing-report/manager/trends')} className="flex-1 min-h-[44px] rounded-xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-600 active:bg-gray-50">Trends</button>
      {depts?.can_manage && (
        <button onClick={() => router.push('/closing-report/manager/questions')} className="flex-1 min-h-[44px] rounded-xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-600 active:bg-gray-50">Questions</button>
      )}
    </div>
  );

  return (
    <div className="max-w-lg mx-auto px-4 pb-24">
      <AppHeader
        supertitle="Closing Report"
        title={deptName || 'Closing Report'}
        subtitle={night ? `Tonight · ${fmtNight(night)}` : undefined}
        showBack={deptId != null && (depts?.departments.length || 0) > 1}
        onBack={() => { setDeptId(null); setPayload(null); }}
        action={<CompanyPill onSwitched={() => { setDeptId(null); setPayload(null); loadDepts(); }} />}
      />

      {loading && (
        <div className="text-center text-gray-400 text-sm py-12">Loading…</div>
      )}

      {!loading && loadError && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center mt-4">
          <p className="text-[14px] text-gray-600">{loadError}</p>
          <button onClick={() => (deptId != null ? loadReport(deptId) : loadDepts())} className="mt-3 min-h-[44px] px-6 rounded-full border border-gray-300 text-[14px] font-semibold text-gray-600">Try again</button>
        </div>
      )}

      {/* Department picker */}
      {!loading && !loadError && depts && deptId == null && (
        <div className="mt-4 space-y-3">
          {depts.departments.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center">
              <div className="text-3xl mb-2" aria-hidden>🌙</div>
              <p className="text-[15px] font-semibold text-gray-800">No closing questions set up yet</p>
              <p className="text-[13.5px] text-gray-500 mt-1">
                {depts.can_manage
                  ? 'Set up the first questions and your team can start reporting tonight.'
                  : 'Ask a manager to set up the closing questions for your department.'}
              </p>
              {depts.can_manage && (
                <button onClick={() => router.push('/closing-report/manager/questions')} className="mt-4 min-h-[46px] px-6 rounded-xl bg-green-600 text-white text-[14px] font-bold active:scale-[0.98]">Set up questions</button>
              )}
            </div>
          ) : (
            <>
              <p className="text-[13px] text-gray-500">Which department are you closing?</p>
              {depts.departments.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDeptId(d.id)}
                  className="w-full bg-white border border-gray-200 rounded-2xl p-4 flex items-center justify-between gap-3 text-left active:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold text-gray-900">{d.name}</span>
                    <span className="block text-[12.5px] text-gray-500 mt-0.5">
                      {d.report ? `Submitted ${fmtTimeBerlin(d.report.submitted_at)} by ${d.report.submitted_by_name}` : `${d.question_count} questions · not submitted yet`}
                    </span>
                  </span>
                  <span className={`flex-shrink-0 text-[11.5px] font-bold rounded-full px-2.5 py-1 ${d.report ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {d.report ? '✓ Done' : 'Open'}
                  </span>
                </button>
              ))}
            </>
          )}
          {managerLinks}
        </div>
      )}

      {/* Read view */}
      {!loading && !loadError && payload?.report && !editing && deptId != null && (
        <div className="mt-4 space-y-3">
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
            <p className="text-[14px] font-bold text-green-800">
              ✓ Report submitted · {fmtTimeBerlin(payload.report.submitted_at)} by {payload.report.submitted_by_name}
            </p>
            <p className="text-[12.5px] text-gray-500 mt-1">
              {payload.editable
                ? `${payload.can_edit ? 'You' : payload.report.submitted_by_name} can correct it until 05:00 tomorrow. After that it is locked as the record for tonight.`
                : 'This report is locked — it is the record for this night.'}
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <ReportView report={payload.report} />
          </div>
          {payload.can_edit && (
            <button onClick={startEditing} className="w-full min-h-[46px] rounded-xl border border-gray-300 bg-white text-[14px] font-semibold text-gray-600 active:bg-gray-50">
              Correct the report
            </button>
          )}
          {managerLinks}
        </div>
      )}

      {/* Fill form (new submission or a pre-lock correction) */}
      {!loading && !loadError && showForm && deptId != null && questions.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <p className="text-[14px] font-bold text-blue-700">{questions.length} questions · under a minute</p>
            <p className="text-[12.5px] text-gray-500 mt-0.5">Your answers go to the managers and tomorrow’s opening team.</p>
          </div>

          {questions.map((q, i) => {
            const d = drafts[q.id] || { value: '', note: '', photos: [] };
            const flagged = !!d.value && q.problem_values.includes(d.value);
            const err = errors[q.id];
            return (
              <div key={q.id} className={`bg-white border rounded-2xl p-4 ${err ? 'border-red-400' : 'border-gray-200'}`}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Question {i + 1}</p>
                <h3 className="text-[15px] font-semibold text-gray-900 mt-1 leading-snug">{q.text}</h3>

                {q.qtype === 'yes_no' && (
                  <OptionButtons values={['yes', 'no']} labels={['Yes', 'No']} selected={d.value} problemValues={q.problem_values} onSelect={(v) => setDraft(q.id, { value: v })} disabled={busy} />
                )}
                {q.qtype === 'choice' && (
                  <OptionButtons values={q.options} selected={d.value} problemValues={q.problem_values} onSelect={(v) => setDraft(q.id, { value: v })} disabled={busy} />
                )}
                {q.qtype === 'rating' && (
                  <>
                    <RatingButtons selected={d.value} problemValues={q.problem_values} onSelect={(v) => setDraft(q.id, { value: v })} disabled={busy} />
                    <p className="text-[12px] text-gray-400 mt-2">1 = rough night · 5 = ran perfectly</p>
                  </>
                )}
                {q.qtype === 'text' && (
                  <textarea
                    value={d.value}
                    onChange={(e) => setDraft(q.id, { value: e.target.value })}
                    disabled={busy}
                    rows={3}
                    placeholder="Optional — write it here"
                    className="w-full mt-3 rounded-xl border-[1.5px] border-gray-200 bg-gray-50 focus:bg-white focus:border-green-600 focus:outline-none p-3 text-[14px]"
                  />
                )}

                {flagged && (
                  <div className="mt-3 pt-3 border-t border-dashed border-red-200">
                    <p className="text-[12.5px] font-bold text-red-600">What happened? (required)</p>
                    <textarea
                      value={d.note}
                      onChange={(e) => setDraft(q.id, { note: e.target.value })}
                      disabled={busy}
                      rows={3}
                      placeholder="e.g. Freezer door seal is broken, the door doesn’t close fully"
                      className="w-full mt-2 rounded-xl border-[1.5px] border-red-200 bg-red-50 focus:bg-white focus:border-red-500 focus:outline-none p-3 text-[14px]"
                    />
                    <div className="mt-2">
                      <PhotoCaptureStrip photos={d.photos} onChange={(photos) => setDraft(q.id, { photos })} disabled={busy} max={3} />
                    </div>
                  </div>
                )}
                {err && <p className="text-[12.5px] font-semibold text-red-600 mt-2">{err}</p>}
              </div>
            );
          })}

          {formError && <p className="text-[13px] font-semibold text-red-600 text-center">{formError}</p>}
          <PrimaryButton busy={busy} onClick={submit} className="w-full">
            {editing ? 'Save corrections' : 'Submit report'}
          </PrimaryButton>
          {editing && (
            <button onClick={() => { setEditing(false); setErrors({}); setFormError(''); }} className="w-full min-h-[44px] rounded-xl text-[14px] font-semibold text-gray-500">
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Department opted in but its questions were all deleted */}
      {!loading && !loadError && payload && !payload.report && !editing && deptId != null && questions.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center mt-4">
          <p className="text-[14px] text-gray-600">No questions are set up for this department yet — ask a manager.</p>
        </div>
      )}

      <Toast
        message={toast?.msg || ''}
        type={toast?.type || 'info'}
        visible={!!toast}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}

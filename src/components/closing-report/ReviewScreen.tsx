'use client';

// Closing Report — the manager's evening in review. Pick a night, see one card
// per participating department: flagged problems on top (with one-tap "Create
// task" into that department's Task Manager list), a grey card when nothing
// was submitted. A bogus report can be removed (confirmed), freeing the night.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import Toast from '@/components/ui/Toast';
import useConfirm from '@/components/ui/useConfirm';
import { CompanyPill } from '@/components/ui/CompanyPill';
import ReportView from './ReportView';
import { ApiError, api, fmtNight, fmtTimeBerlin, type ApiAnswer, type ApiReport } from './common';

interface ReviewEntry {
  department_id: number;
  name: string;
  report: ApiReport | null;
}

interface ReviewPayload {
  date: string;
  entries: ReviewEntry[];
  can_manage: boolean;
}

export default function ReviewScreen() {
  const router = useRouter();
  const { confirm, confirmElement } = useConfirm();
  const [date, setDate] = useState<string | null>(null); // null = current night
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [taskBusy, setTaskBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [currentNight, setCurrentNight] = useState<string | null>(null);
  const token = useRef(0);

  const load = useCallback(async (d: string | null) => {
    const my = ++token.current;
    setLoading(true);
    setLoadError('');
    try {
      const p = await api<ReviewPayload>(`/api/closing-report/review${d ? `?date=${d}` : ''}`);
      if (my !== token.current) return;
      setPayload(p);
      setDate(p.date);
      if (!d) setCurrentNight(p.date); // an unqualified load returns the current night
    } catch (e) {
      if (my !== token.current) return;
      setLoadError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      if (my === token.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);

  function shift(days: number) {
    if (!date) return;
    const t = Date.parse(date + 'T00:00:00Z') + days * 86_400_000;
    load(new Date(t).toISOString().slice(0, 10));
  }
  const isCurrentNight = !!date && !!currentNight && date >= currentNight;

  async function createTask(entry: ReviewEntry, answer: ApiAnswer) {
    if (taskBusy) return;
    const ok = await confirm({
      title: 'Create a follow-up task?',
      message: `“${answer.note || answer.question_text}” becomes a task on ${entry.name}’s list for today.`,
      confirmLabel: 'Create task',
    });
    if (!ok) return;
    setTaskBusy(answer.id);
    try {
      const res = await api<{ ok: true; task_line_id: number }>('/api/closing-report/create-task', {
        method: 'POST',
        body: JSON.stringify({ answer_id: answer.id, name: answer.note || `Follow up: ${answer.question_text}` }),
      });
      // Patch in place — no reload, no scroll jump.
      setPayload((prev) => prev && ({
        ...prev,
        entries: prev.entries.map((en) => en.department_id !== entry.department_id ? en : ({
          ...en,
          report: en.report && ({
            ...en.report,
            answers: en.report.answers.map((a) => a.id === answer.id ? { ...a, task_line_id: res.task_line_id } : a),
          }),
        })),
      }));
      setToast({ msg: `Task added to ${entry.name} · Task Manager`, type: 'success' });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Could not create the task.', type: 'error' });
      if (e instanceof ApiError && e.status === 409 && date) load(date);
    } finally {
      setTaskBusy(null);
    }
  }

  async function removeReport(entry: ReviewEntry) {
    if (!entry.report) return;
    const ok = await confirm({
      title: 'Remove this report?',
      message: `${entry.name}’s report for ${fmtNight(entry.report.report_date)} will be removed so the night can be re-submitted. This cannot be undone.`,
      confirmLabel: 'Remove report',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/api/closing-report/report/${entry.report.id}`, { method: 'DELETE' });
      setPayload((prev) => prev && ({
        ...prev,
        entries: prev.entries.map((en) => en.department_id === entry.department_id ? { ...en, report: null } : en),
      }));
      setToast({ msg: 'Report removed', type: 'success' });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Could not remove the report.', type: 'error' });
    }
  }

  const problemCount = (r: ApiReport) => r.answers.filter((a) => a.is_problem).length;

  return (
    <div className="max-w-lg mx-auto px-4 pb-24">
      <AppHeader
        supertitle="Closing Reports"
        title="Review"
        subtitle="One report per department per night"
        backHref="/closing-report"
        action={<CompanyPill onSwitched={() => load(null)} />}
      />

      {/* Night picker */}
      <div className="bg-white border border-gray-200 rounded-2xl p-2 mt-4 flex items-center justify-between">
        <button onClick={() => shift(-1)} aria-label="Previous night" className="w-11 h-11 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 text-lg active:bg-gray-100">‹</button>
        <div className="text-center">
          <p className="text-[15px] font-bold text-gray-900">{date ? fmtNight(date) : '…'}</p>
          <p className="text-[11.5px] text-gray-400">night of</p>
        </div>
        <button
          onClick={() => shift(1)}
          aria-label="Next night"
          disabled={!!isCurrentNight}
          className="w-11 h-11 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 text-lg active:bg-gray-100 disabled:opacity-40"
        >›</button>
      </div>

      {loading && <div className="text-center text-gray-400 text-sm py-12">Loading…</div>}

      {!loading && loadError && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center mt-4">
          <p className="text-[14px] text-gray-600">{loadError}</p>
          <button onClick={() => load(date)} className="mt-3 min-h-[44px] px-6 rounded-full border border-gray-300 text-[14px] font-semibold text-gray-600">Try again</button>
        </div>
      )}

      {!loading && !loadError && payload && (
        <div className="mt-4 space-y-3">
          {payload.entries.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center">
              <p className="text-[14px] text-gray-600">No department takes part yet — set up questions first.</p>
              <button onClick={() => router.push('/closing-report/manager/questions')} className="mt-4 min-h-[46px] px-6 rounded-xl bg-green-600 text-white text-[14px] font-bold active:scale-[0.98]">Set up questions</button>
            </div>
          )}

          {payload.entries.map((entry) => (
            <div key={entry.department_id} className={`rounded-2xl p-4 border ${entry.report ? 'bg-white border-gray-200' : 'bg-transparent border-dashed border-gray-300'}`}>
              {entry.report ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[15px] font-bold text-gray-900 min-w-0">{entry.name}</span>
                    <span className={`flex-shrink-0 text-[11.5px] font-bold rounded-full px-2.5 py-1 ${problemCount(entry.report) > 0 ? 'bg-red-50 text-red-600' : 'bg-green-100 text-green-700'}`}>
                      {problemCount(entry.report) > 0 ? `${problemCount(entry.report)} problem${problemCount(entry.report) > 1 ? 's' : ''}` : 'All clear'}
                    </span>
                  </div>
                  <p className="text-[12px] text-gray-500 mt-0.5 mb-3">
                    Submitted {fmtTimeBerlin(entry.report.submitted_at)} by {entry.report.submitted_by_name}
                  </p>
                  <ReportView
                    report={entry.report}
                    problemExtra={(a) => (
                      a.task_line_id && a.task_line_id > 0 ? (
                        <p className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-green-700 bg-green-100 rounded-full px-3 py-1.5">✓ Task created — on {entry.name}’s list</p>
                      ) : (
                        <button
                          onClick={() => createTask(entry, a)}
                          disabled={taskBusy === a.id}
                          className="mt-2.5 min-h-[40px] px-4 rounded-full bg-green-600 text-white text-[13px] font-bold active:scale-[0.98] disabled:opacity-60"
                        >
                          {taskBusy === a.id ? 'Creating…' : '＋ Create task in Task Manager'}
                        </button>
                      )
                    )}
                  />
                  <div className="flex justify-end gap-4 mt-3 pt-2 border-t border-gray-100">
                    <button onClick={() => router.push(`/closing-report/report/${entry.report?.id}`)} className="text-[12.5px] font-semibold text-gray-500 min-h-[44px]">Open full record</button>
                    {payload.can_manage && (
                      <button onClick={() => removeReport(entry)} className="text-[12.5px] font-semibold text-red-500 min-h-[44px]">Remove</button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-2">
                  <p className="text-[15px] font-bold text-gray-500">{entry.name}</p>
                  <p className="text-[13px] text-gray-400 mt-1">No report submitted</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmElement}
      <Toast message={toast?.msg || ''} type={toast?.type || 'info'} visible={!!toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

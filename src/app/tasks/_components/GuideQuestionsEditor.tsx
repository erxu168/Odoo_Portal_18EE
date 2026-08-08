'use client';

/**
 * The few questions a guide asks to check it was taken in.
 *
 * Its own save, not part of the guide's. The guide's save is an atomic rebuild
 * of every step and its photo bytes; questions change on a different rhythm — an
 * author rewords one without touching a picture — and a mistake here must never
 * be able to cost anyone their step media.
 *
 * The AI writer drafts these; this is where they get corrected. That is the
 * workflow the owner chose: approving forty questions beats writing forty.
 */
import { useEffect, useRef, useState } from 'react';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { useConfirm } from '@/components/ui/useConfirm';

const MAX_QUESTIONS = 20;
const MAX_ANSWERS = 4;

interface Answer { text: string; is_correct: boolean }
interface Question {
  /** Local identity, so removing one row cannot slide another's state. */
  uid: string;
  text: string;
  /** 1-based step POSITION this is taught by; 0 = not tied to a step. Never a
   *  step id — saving a guide destroys and reissues every one of those. */
  explain_step: number;
  answers: Answer[];
}

export interface GuideQuestionRead {
  text: string;
  explain_step: number;
  answers: Answer[];
}

export default function GuideQuestionsEditor({ guideId, stepCount, initial, disabled, onSaved }: {
  guideId: number;
  /** How many steps the guide has — bounds which step a question can point at. */
  stepCount: number;
  initial: GuideQuestionRead[];
  disabled?: boolean;
  onSaved?: () => void;
}) {
  const uid = useRef(0);
  const [questions, setQuestions] = useState<Question[]>(
    () => initial.map(q => ({ uid: `q${uid.current++}`, ...q })),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { confirm, confirmElement } = useConfirm();

  // Re-hydrate when the guide reloads underneath (the editor re-GETs after
  // every step save, which reissues ids and could otherwise leave this stale).
  useEffect(() => {
    setQuestions(initial.map(q => ({ uid: `q${uid.current++}`, ...q })));
    setDirty(false);
  }, [initial]);

  function patch(id: string, change: Partial<Question>) {
    setQuestions(prev => prev.map(q => (q.uid === id ? { ...q, ...change } : q)));
    setDirty(true); setSaved(false);
  }

  function patchAnswer(id: string, i: number, change: Partial<Answer>) {
    setQuestions(prev => prev.map(q => {
      if (q.uid !== id) return q;
      const answers = q.answers.map((a, j) => (j === i ? { ...a, ...change } : a));
      // Exactly one correct: marking one unmarks the rest, rather than letting
      // an author create a question that can never be passed or never failed.
      if (change.is_correct) {
        return { ...q, answers: answers.map((a, j) => ({ ...a, is_correct: j === i })) };
      }
      return { ...q, answers };
    }));
    setDirty(true); setSaved(false);
  }

  /** Says what is wrong before a round trip, in the author's own terms. */
  function problem(): string | null {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const n = i + 1;
      if (!q.text.trim()) return `Question ${n} has no wording.`;
      if (q.answers.length < 2) return `Question ${n} needs at least two answers.`;
      if (q.answers.some(a => !a.text.trim())) return `Question ${n} has a blank answer.`;
      if (q.answers.filter(a => a.is_correct).length !== 1) {
        return `Question ${n} needs exactly one correct answer marked.`;
      }
      if (q.explain_step < 0 || q.explain_step > stepCount) {
        return `Question ${n} points at a step that does not exist.`;
      }
    }
    return null;
  }

  async function save() {
    const bad = problem();
    if (bad) { setError(bad); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/tasks/guides/${guideId}/questions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: questions.map(q => ({
            text: q.text.trim(),
            explain_step: q.explain_step,
            answers: q.answers.map(a => ({ text: a.text.trim(), is_correct: a.is_correct })),
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) { setError(body.error || 'Could not save the questions.'); return; }
      setDirty(false); setSaved(true);
      onSaved?.();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(q: Question) {
    if (q.text.trim() && !await confirm({
      title: 'Remove this question?',
      message: q.text.trim().slice(0, 120),
      confirmLabel: 'Remove',
      variant: 'danger',
    })) return;
    setQuestions(prev => prev.filter(p => p.uid !== q.uid));
    setDirty(true); setSaved(false);
  }

  return (
    <div>
      {confirmElement}
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide">
          Questions {questions.length > 0 && `· ${questions.length}`}
        </p>
        {dirty && <span className="text-[var(--fs-xs)] font-semibold text-amber-700">Not saved</span>}
        {!dirty && saved && <span className="text-[var(--fs-xs)] font-semibold text-green-700">Saved</span>}
      </div>
      <p className="text-[var(--fs-xs)] text-gray-400 mb-2 leading-snug">
        Asked after someone reads this guide. Every answer must be right to pass, and a wrong
        one sends them back to the step you name — so a retry costs a re-read, not a wait.
        A guide with no questions is done when it is read.
      </p>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[var(--fs-xs)] font-semibold text-red-700 mb-2">
          {error}
        </p>
      )}

      {questions.map((q, qi) => (
        <div key={q.uid} className="rounded-lg border border-gray-200 p-2.5 mb-2">
          <div className="flex items-start gap-2">
            <span className="text-[var(--fs-xs)] font-bold text-gray-400 mt-2.5 w-4 flex-shrink-0">{qi + 1}</span>
            <textarea
              value={q.text}
              onChange={e => patch(q.uid, { text: e.target.value })}
              disabled={disabled}
              rows={2}
              placeholder="What do you do if…?"
              className="flex-1 min-w-0 px-2.5 py-2 border border-gray-200 rounded-lg text-[var(--fs-sm)] leading-snug focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              type="button"
              onClick={() => void remove(q)}
              disabled={disabled}
              aria-label={`Remove question ${qi + 1}`}
              className="min-h-[44px] px-2 text-[var(--fs-xs)] font-semibold text-red-500 hover:text-red-600 flex-shrink-0"
            >
              Remove
            </button>
          </div>

          <div className="mt-2 pl-6 space-y-1.5">
            {q.answers.map((a, ai) => (
              <div key={ai} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => patchAnswer(q.uid, ai, { is_correct: true })}
                  disabled={disabled}
                  aria-label={`Mark answer ${ai + 1} correct`}
                  aria-pressed={a.is_correct}
                  className={`w-6 h-6 rounded-full border-2 flex-shrink-0 grid place-items-center ${
                    a.is_correct ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white'
                  }`}
                >
                  {a.is_correct && (
                    <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <input
                  value={a.text}
                  onChange={e => patchAnswer(q.uid, ai, { text: e.target.value })}
                  disabled={disabled}
                  placeholder={ai === 0 ? 'The right answer' : 'A mistake someone would really make'}
                  className="flex-1 min-w-0 px-2.5 min-h-[40px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                {q.answers.length > 2 && (
                  <button
                    type="button"
                    onClick={() => patch(q.uid, { answers: q.answers.filter((_, j) => j !== ai) })}
                    disabled={disabled}
                    aria-label={`Remove answer ${ai + 1}`}
                    className="w-9 h-9 grid place-items-center text-gray-400 hover:text-red-600 flex-shrink-0"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {q.answers.length < MAX_ANSWERS && (
              <button
                type="button"
                onClick={() => patch(q.uid, { answers: [...q.answers, { text: '', is_correct: false }] })}
                disabled={disabled}
                className="min-h-[36px] text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800"
              >
                + Another answer
              </button>
            )}

            <label className="flex items-center gap-2 pt-1">
              <span className="text-[var(--fs-xs)] text-gray-500 flex-shrink-0">Covered by</span>
              <select
                value={q.explain_step}
                onChange={e => patch(q.uid, { explain_step: Number(e.target.value) })}
                disabled={disabled || stepCount === 0}
                className="min-h-[40px] px-2 border border-gray-200 rounded-lg text-[var(--fs-xs)] bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value={0}>no particular step</option>
                {Array.from({ length: stepCount }, (_, i) => (
                  <option key={i + 1} value={i + 1}>step {i + 1}</option>
                ))}
              </select>
              <span className="text-[var(--fs-xs)] text-gray-400 min-w-0">
                where a wrong answer sends them
              </span>
            </label>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {questions.length < MAX_QUESTIONS && (
          <button
            type="button"
            onClick={() => {
              setQuestions(prev => [...prev, {
                uid: `q${uid.current++}`, text: '', explain_step: 0,
                answers: [{ text: '', is_correct: true }, { text: '', is_correct: false }],
              }]);
              setDirty(true); setSaved(false);
            }}
            disabled={disabled}
            className="min-h-[44px] text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800"
          >
            + Add a question
          </button>
        )}
        {(dirty || questions.length > 0) && (
          <PrimaryButton busy={saving} disabled={disabled || !dirty} onClick={save} className="ml-auto w-auto px-5">
            {saving ? 'Saving…' : 'Save questions'}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

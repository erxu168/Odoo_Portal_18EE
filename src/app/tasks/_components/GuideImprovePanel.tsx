'use client';

/**
 * "Finish this guide" — the AI proposes better wording for the weak steps.
 *
 * It proposes; it never writes. Each change is kept or skipped one at a time,
 * and keeping one only edits the step in the editor — the manager still presses
 * Save. So nothing AI-written reaches a cook without a person choosing it twice.
 *
 * Built for the shape Ethan's drafts are actually in: not empty, but UNEVEN —
 * real knowledge in some steps ("zone 1 crisps the skin at 260-280°C") and
 * placeholders in others ("The different positions of the dial."). Which is why
 * the steps it leaves alone are shown too: a step it could not write is a gap
 * only a person can fill, and it should be visible rather than silently skipped.
 */
import { useState } from 'react';
import PrimaryButton from '@/components/ui/PrimaryButton';

const MAX_NOTES = 4000;

interface Proposal { number: number; text: string; reason: string }
interface Skipped { number: number; reason: string }

export default function GuideImprovePanel({ guideId, stepText, disabled, onApply }: {
  guideId: number;
  /** Current plain text of each step, by 1-based number — for the before/after. */
  stepText: (n: number) => string;
  disabled?: boolean;
  /** Keep this one: write it into the step the manager will later save. */
  onApply: (stepNumber: number, text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [done, setDone] = useState<Set<number>>(new Set());

  async function run() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/tasks/guides/${guideId}/improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) { setError(body.error || 'Could not work on the guide.'); return; }
      setProposals(body.proposals || []);
      setSkipped(body.skipped || []);
      setDone(new Set());
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function keep(p: Proposal) {
    onApply(p.number, p.text);
    setDone(prev => new Set(prev).add(p.number));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-white text-[var(--fs-sm)] font-semibold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50"
      >
        <span aria-hidden="true">✨</span>
        Finish this guide with AI
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-bold text-[var(--fs-sm)] text-gray-800">Finish this guide</p>
          <p className="text-[var(--fs-xs)] text-gray-500 leading-snug mt-0.5">
            It reads your photos and the steps you have written, and suggests wording for the
            weak ones. It leaves the good ones alone.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close"
          className="w-9 h-9 grid place-items-center rounded-lg text-gray-400 hover:text-gray-700 flex-shrink-0">✕</button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[var(--fs-xs)] font-semibold text-red-700 mb-2">
          {error}
        </p>
      )}

      {proposals === null ? (
        <>
          <label className="block">
            <span className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">
              Anything it cannot see in the photos
            </span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, MAX_NOTES))}
              rows={4}
              disabled={disabled || busy}
              placeholder={'- the dial goes off / low / high, clockwise\n- pilot light is behind the 2nd rack\n- never run zone 2 above 180'}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-[var(--fs-sm)] leading-relaxed focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </label>
          <p className="text-[var(--fs-xs)] text-gray-400 mt-1 mb-2 leading-snug">
            It will not invent a temperature, a time or a setting. If it cannot tell what a step
            should say, it says so instead of guessing — and you fill that one in yourself.
          </p>
          <PrimaryButton busy={busy} disabled={disabled} onClick={run} className="w-full">
            {busy ? 'Reading the guide… about 30 seconds' : '✨ Suggest wording'}
          </PrimaryButton>
        </>
      ) : (
        <>
          {proposals.length === 0 && skipped.length === 0 && (
            <p className="text-[var(--fs-sm)] text-gray-500 py-4 text-center">
              Nothing to suggest — every step already says what to do.
            </p>
          )}

          {proposals.map(p => {
            const before = stepText(p.number);
            const applied = done.has(p.number);
            return (
              <div key={p.number} className={`rounded-lg border-l-[3px] px-3 py-2.5 mb-2 ${
                applied ? 'border-l-green-500 bg-green-50 border border-green-100' : 'border-l-gray-300 bg-gray-50 border border-gray-100'
              }`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  Step {p.number}{p.reason ? ` · ${p.reason}` : ''}
                </p>
                {before && (
                  <p className="text-[var(--fs-xs)] text-gray-400 line-through mb-1 leading-snug">{before}</p>
                )}
                <p className="text-[var(--fs-sm)] text-gray-800 leading-snug">{p.text}</p>
                <div className="flex gap-2 mt-2">
                  {applied ? (
                    <span className="text-[var(--fs-xs)] font-bold text-green-700 min-h-[36px] inline-flex items-center">
                      ✓ Put into step {p.number}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => keep(p)}
                      disabled={disabled}
                      className="min-h-[36px] px-4 rounded-lg bg-green-600 text-white text-[var(--fs-xs)] font-bold hover:bg-green-700 disabled:opacity-50"
                    >
                      Use this
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {skipped.length > 0 && (
            // The steps it would not write are the ones a PERSON has to. Hiding
            // them would turn a known gap into a silent one.
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 mb-2">
              <p className="text-[var(--fs-xs)] font-extrabold text-amber-900 mb-1">
                {skipped.length} step{skipped.length === 1 ? '' : 's'} left for you
              </p>
              {skipped.map(s => (
                <p key={s.number} className="text-[var(--fs-xs)] text-amber-900 leading-snug">
                  <b>Step {s.number}:</b> {s.reason}
                </p>
              ))}
            </div>
          )}

          <p className="text-[var(--fs-xs)] text-gray-400 mb-2 leading-snug">
            Using a suggestion only edits the step here. Nothing is saved until you press
            <b> Save guide</b>, and staff see nothing until it is published.
          </p>
          <button
            type="button"
            onClick={() => { setProposals(null); setDone(new Set()); }}
            disabled={disabled || busy}
            className="w-full min-h-[44px] rounded-xl border border-gray-200 text-[var(--fs-sm)] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            ↻ Suggest again (costs again)
          </button>
        </>
      )}
    </div>
  );
}
